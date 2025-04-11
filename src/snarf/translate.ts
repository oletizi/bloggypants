import fs from 'fs/promises'
import path from 'node:path'
import {format} from 'date-fns'
import {JSDOM} from 'jsdom'
import TurndownService from 'turndown'

const width = `100%`
const sourcedir = path.join('build', 'snarfed')
const targetdir = path.join('src', 'pages')
const turndownService = new TurndownService()
const layoutPath = path.join('..', '..', '..', 'layouts', 'layout.astro')
const figureImport = 'import {Figure} from "../../../components/Figure.tsx"'

/**
 * Special handling for <figure>
 */
turndownService.addRule('figure', {
    filter: 'figure',
    replacement: function (_content, node: Node, _options) {
        const e = node as Element
        const img = e.querySelector('img')
        const caption = e.querySelector('figcaption')?.textContent
        const src = img ? img.getAttribute('src') : ''

        return `<Figure src="${src}" width={"${width}"} caption="${caption}"/>`
    }
})


/**
 * Special handling for <img>
 */
turndownService.addRule('img', {
    filter: 'img',
    replacement: function (_content, node: Node, _options) {
        const e = node as Element
        e.setAttribute('src', antinormalizeDecode(e.getAttribute('src')))
        const src = e.getAttribute('src') //antinormalizeDecode(e.getAttribute('src'))

        const alt = e.hasAttribute('alt') ? e.getAttribute('alt') : ''
        const clazz = e.getAttribute('class') ? e.getAttribute('class') : ''
        if (clazz && clazz.includes('wp-post-image')) {
            return ''
        } else {
            return `<img class="" src="${src}" alt="${alt}">`
        }
    }
})

/**
 * Special handling for <style>
 */
turndownService.addRule('style', {
    filter: 'style',
    replacement: function (_content, _node, _options) {
        return ''
    }
})

/**
 * Translate the path to the source HTML file to the path of the destination markdown file
 *
 * @param sourceDir
 * @param targetDir
 * @param htmlPath
 */
function translateHtmlPathToMarkdownPath(sourceDir: string, targetDir: string, htmlPath: string) {
    return htmlPath.replace(sourceDir, targetDir).replace('index.html', 'index.mdx')
}

/**
 * Define where images are stored relative to the markdown file
 *
 * @param markdownPath
 * @param imageName
 */
function translateImagePath(markdownPath: string, imageName: string): string {
    return path.join(path.dirname(markdownPath), imageName)
}

/**
 * Looks for html files in ${sourcedir} and applies the translate() function
 */
async function main() {
    const todo = [sourcedir]
    const index = []
    while (todo.length > 0) {
        const item = todo.pop()
        if (item) {
            try {
                const stats = await fs.stat(item)
                if (stats.isDirectory()) {
                    for (const child of await fs.readdir(item)) {
                        todo.push(path.join(item, child))
                    }
                } else {
                    if (stats.isFile() && item.endsWith('index.html')) {
                        // const markdownPath = item.replace('index.html', 'index.mdx').replace('build/snarfed', 'src/pages')
                        const markdownPath = translateHtmlPathToMarkdownPath(sourcedir, targetdir, item)
                        await translate(item, markdownPath)
                        index.push(markdownPath)
                    } else {
                        console.log(`Not sure what this is: ${item}`)
                    }
                }
            } catch (e) {
                // huh.
                console.error(e)
            }
        }
    }
}

/**
 * Translates an html file snarfed from tetrate.io to markdown.
 * See snarf.ts
 *
 * @param inpath the source html fils
 * @param outpath the destination markdown/mdx file
 */
async function translate(inpath: string, outpath: string) {
    let title = ''
    let author = ''
    let date = new Date()
    let featuredImage = ''
    const outdir = path.dirname(outpath)
    console.log(`translate(): inpath: ${inpath}, outpath: ${outpath}, outdir: ${outdir}`)
    try {
        await fs.stat(outdir)
    } catch (e) {
        await fs.mkdir(outdir, {recursive: true})
    }

    //
    // Find H1 tag and make it the title
    //
    const html = (await fs.readFile(inpath)).toString()
    const dom = new JSDOM(html)
    const doc = dom.window.document
    const h1 = doc.querySelector('h1')
    if (h1 && h1.textContent) {
        title = h1.textContent?.trim()
    }
    console.log(`  TITLE: ${title}`)

    //
    // Find the <time.entry__published> tag and make it the date
    //
    const published = doc.querySelector('time.entry__published')
    if (published && published.hasAttribute('datetime')) {
        const datetime = published.getAttribute('datetime')
        if (datetime) {
            date = new Date(Date.parse(datetime))
        }
    }
    console.log(`  DATE : ${date}`)

    //
    // Find and parse the <span> containing the byline and make it the author
    //
    const spans = doc.querySelectorAll('#site-content p span')
    for (const span of spans) {
        if (span.textContent && span.textContent.toLowerCase().includes('author')) {
            const [_label, value] = span.textContent.split(': ')
            if (value) {
                author = value.trim()
            }
        }
    }
    console.log(`  AUTHOR: ${author}`)

    //
    // Find <div.entry__content> and transform it to markdown
    //
    const entry = doc.querySelector('div.entry__content')
    if (entry) {
        //
        // Download images from tetrate.io
        //
        const images = entry.querySelectorAll('img')
        if (images) {
            for (const image of images) {
                let src = image.src

                if (src && src.startsWith('/')) {
                    src = 'https://tetrate.io' + src
                    const imageUrl = new URL(src)
                    let imageName = path.basename(imageUrl.pathname)
                    // const outfile = path.join(outdir.replace('src/pages', 'public'), filename)
                    const outfile = translateImagePath(outpath, imageName)
                    try {
                        await fs.stat(outfile)
                        console.log(`  IMAGE CACHE HIT: ${outfile}`)
                    } catch (e) {
                        console.log(`  IMAGE CACHE MISS: ${outfile}`)
                        console.log(`  fetching image: ${imageUrl}`)
                        const res = await fetch(imageUrl)
                        if (res.ok) {
                            console.log(`  writing image to: ${outfile}`)
                            try {
                                await fs.stat(path.dirname(outfile))
                            } catch (e) {
                                await fs.mkdir(path.dirname(outfile), {recursive: true})
                            }
                            await fs.writeFile(outfile, await res.bytes())
                            console.log(`  done.`)
                        } else {
                            console.error(`BARF: Error fetching image: ${imageUrl}: ${res.status} ${res.statusText}`)
                        }
                    }
                    // update the image url
                    // image.src = `ANTINORMALIZE${path.basename(outfile)}`
                    image.src = antinormalizeEncode(path.basename(outfile))
                    console.log(`  updated image src: ${image.src}`)
                    if (image.hasAttribute('class') && image.getAttribute('class')?.includes('wp-post-image')) {
                        featuredImage = image.src
                    }
                }
            }
        }

        //
        // Convert html to markdown
        //
        let markdown = turndownService.turndown(entry.innerHTML)
        markdown =
            `---\n` +
            `layout: ${layoutPath}\n` +
            `title: ${title}\n` +
            `author: ${author}\n` +
            `date: ${format(date, 'yyyy-MM-dd')}\n` +
            `featuredImage: ${featuredImage}\n` +
            `---\n` +
            `${figureImport}\n\n` + // mdx parser seems to want a double newline after imports
            markdown

        await fs.writeFile(outpath, markdown)
    } else {
        console.error('BARF: NO entry content')
    }
}

function antinormalizeEncode(src: string | null): string {
    // return src
    //     ? antinormalizeToken + path.basename(src)
    //     : ''
    return src ? path.basename(src) : ''
}

function antinormalizeDecode(src: string | null): string {
    // return src && src.includes(antinormalizeToken)
    //     ? './' + src.substring(src.indexOf(antinormalizeToken) + antinormalizeToken.length)
    //     : src ? src : ''
    return src ? src : ''
}


main().then(() => {
    console.log('Done.')
})