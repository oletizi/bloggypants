import fs from 'fs/promises'
import path from 'node:path'
import {format, isAfter} from 'date-fns'
import {JSDOM} from 'jsdom'
import TurndownService from 'turndown'

const width = `100%`
const sourcedir = path.join('build', 'snarfed')
const targetdir = path.join('src', 'pages')
const turndownService = new TurndownService()
const layoutName = 'layout.astro'
const componentImports = [
    `import {Image} from "astro:assets"`,
    'import Figure from "@/components/Figure.astro"',
    'import InlinePromo from "@/components/InlinePromo.astro"',
]
// XXX: Ick. These shouldn't be global, but can't figure out how to pass a scoped version of them into the turndown service
// for access by the relevant rules. If this was long-lived code, I'd do it differently
const imageMap: Map<string, string> = new Map()
let currentArticle: Article | null = null

interface Article {
    slug: string,
    title: string,
    excerpt: string,
    featuredImage: string,
    categories: string[],
    author: string,
    date: Date,
    figures: string[]
}

/**
 * Special handling for headings
 */
turndownService.addRule('h', {
    filter: ['h2', 'h3', 'h4'],
    replacement: function (content, node, _options) {
        let heading = ''
        switch (node.nodeName.toLowerCase()) {
            case 'h2':
                heading = '##'
                break
            case 'h3':
                heading = '###'
                break
            case 'h4':
                heading = '####'
                break
            case 'h5':
                heading = '#####'
                break
        }
        return heading + ' ' + content + '\n\n'
    }
})

function cleanCodeBlock(content: string) {
    return content.trim()
        .replaceAll('\\\\', '\\')
        .replaceAll('\\`', '`')
        .replaceAll('\\[', '[')
        .replaceAll('\\]', ']')
        .replaceAll('\\_', '_')
}

/**
 * Special handling for code blocks
 */
turndownService.addRule('pre', {
    filter: 'pre',
    replacement: function (content, node, _options) {
        // EnlighterJSRAW
        const e = node as HTMLElement
        if (e.hasAttribute('class') && e.getAttribute('class')?.includes('EnlighterJSRAW')) {
            const lang = e.getAttribute('data-enlighter-language') ? e.getAttribute('data-enlighter-language') : ''
            let cleaned = cleanCodeBlock(content)
            return ('```' + lang + '\n' +
                cleaned
                +
                '\n```\n\n')
        } else if (e.hasAttribute('class') && e.getAttribute('class')?.includes('wp-block-code')) {
            return '```\n' + cleanCodeBlock(content) + '\n```\n\n'
        } else {
            return content
        }
    }
})

/**
 * Special handling for <figure>
 */
turndownService.addRule('figure', {
    filter: 'figure',
    replacement: function (_content, node: Node, _options) {
        const e = node as Element
        if (e.querySelector('iframe')) {
            return `<figure>${_content}</figure>\n\n`
        }
        const img = e.querySelector('img')
        let tmp = e.querySelector('figcaption')?.textContent
        let caption: string = tmp ? tmp : ''
        caption.replace(/Figure\s*\d*:*/, '')
        const src = img ? img.getAttribute('src') : ''
        const importedImage = src ? imageMap.get(src) : null
        currentArticle?.figures.push(src ? src : '')
        if (importedImage) {
            return `<Figure source={${src ? imageMap.get(src) : ''}} width={"${width}"} caption="${caption}" index={${currentArticle?.figures?.length}}/>\n`
        } else {
            return `<figure>![${caption}](${src})<figcaption>${caption}</figcaption></figure>`
        }
    }
})

/**
 * Special handling for whatever 'application/ld+json' is.
 */
turndownService.addRule('script', {
    filter: 'script',
    replacement: function (content, node, _options) {
        const e = node as Element
        if (e.getAttribute('type') && e.getAttribute('type')?.includes('application/ld+json')) {
            return '\n'
        }
        return content
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
        const importedImage = src ? imageMap.get(src) : null
        if (clazz && clazz.includes('wp-post-image')) {
            return ''
        } else if (importedImage) {
            return `<Image class="" src="${importedImage}" alt="${alt}">`
        } else {
            return ''
        }
    }
})

/**
 * Special handling for inline promo
 */
turndownService.addRule('blockquote', {
    filter: 'blockquote',
    replacement: function (content, node: Node, _options) {
        const e = node as HTMLElement
        if (e.textContent?.includes('Tetrate offers an enterprise-ready')) {
            return '<InlinePromo product="tis"/>\n\n'
        } else {
            return content
        }
    }
})

/**
 * Leave anchor tags untouched for imported content. It's just easier that way
 */
turndownService.keep('a')

/**
 * Leave iframes untouched.
 */
turndownService.keep('iframe')


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
    const articles: Article[] = []
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
                        const article = await translate(item, markdownPath)
                        articles.push(article)
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
    let content = '<ul>'
    for (const item of articles.sort((a, b) => {
        return b.date.getTime() - a.date.getTime()
    })) {
        console.log(item)
        const slug = item.slug
        content += `<li><span>${format(item.date, 'yyyy-MM-dd')}: </span><a href="${slug}" target="_blank">${path.basename(slug)}</a></li>\n`
    }
    content += '</ul>'
    await fs.writeFile('src/pages/blogs.md', content, 'utf8')
}

/**
 * Translates an html file snarfed from tetrate.io to markdown.
 * See snarf.ts
 *
 * @param inpath the source html fils
 * @param outpath the destination markdown/mdx file
 */
async function translate(inpath: string, outpath: string) {
    const article: Article = currentArticle = {
        author: '',
        categories: [],
        date: new Date(Date.parse('2018-01-01')),
        excerpt: '',
        featuredImage: '',
        slug: path.dirname(outpath.replace(targetdir, '')),
        title: '',
        figures: [],
    }
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
        article.title = encodeURIComponent(h1.textContent?.trim())
    }
    console.log(`  TITLE: ${article.title}`)

    //
    // Find the <time.entry__published> tag and make it the date
    //
    const published = doc.querySelector('time.entry__published')
    if (published && published.hasAttribute('datetime')) {
        const datetime = published.getAttribute('datetime')
        if (datetime) {
            article.date = new Date(Date.parse(datetime))
        }
    }
    console.log(`  DATE : ${article.date}`)

    //
    // Find and parse the <span> containing the byline and make it the author
    //
    const spans = doc.querySelectorAll('#site-content p span')
    for (const span of spans) {
        if (span.textContent && span.textContent.toLowerCase().includes('author')) {
            const [_label, value] = span.textContent.split(': ')
            if (value) {
                article.author = value.trim()
            }
        }
    }
    console.log(`  AUTHOR: ${article.author}`)

    //
    // Find <div.entry__content> and transform it to markdown
    //
    const entry = doc.querySelector('div.entry__content')
    if (entry) {
        //
        // Download images from tetrate.io
        //
        const images = entry.querySelectorAll('img')
        const imports: string[] = []

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
                    image.src = antinormalizeEncode(path.basename(outfile))
                    const importedImage = `img${imports.length}`
                    imageMap.set(image.src, importedImage)
                    imports.push(`import ${importedImage} from "${image.src}"`)
                    console.log(`  updated image src: ${image.src}`)
                    if (image.hasAttribute('class') && image.getAttribute('class')?.includes('wp-post-image')) {
                        article.featuredImage = image.src
                    }
                }
            }
        }


        const relativePath = outpath.replace(targetdir, '')
        const layoutPath = path.join(path.join(path.dirname(relativePath).split('/').map(_i => '..').join('/')), 'layouts', layoutName)
        //
        // Convert html to markdown
        //
        let markdown = turndownService.turndown(entry.innerHTML)
        markdown =
            `---\n` +
            `layout: ${layoutPath}\n` +
            `slug: ${article.slug}\n` +
            `title: ${article.title}\n` +
            (article.author ? `author: ${article.author}\n` : '') +
            (isAfter(article.date, '2018-12-31') ? `date: ${format(article.date, 'yyyy-MM-dd')}\n` : '') +
            `featuredImage: ${article.featuredImage}\n` +
            `---\n` +
            componentImports.join('\n') + '\n' +
            imports.join('\n') +
            `\n\n` +
            markdown

        await fs.writeFile(outpath, markdown)
    } else {
        console.error('BARF: NO entry content')
    }
    return article
}

function antinormalizeEncode(src: string | null): string {
    return src ? path.basename(src) : ''
}

function antinormalizeDecode(src: string | null): string {
    return src ? src : ''
}


main().then(() => {
    console.log('Done.')
})