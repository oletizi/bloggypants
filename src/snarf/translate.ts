import fs from 'fs/promises'
import path from 'node:path'
import {JSDOM} from 'jsdom'
import TurndownService from 'turndown'
//<div id="site-content
//  <h1 class="c-heading u-font-h2 u-color-light">
//                     <p class="u-fz-h6 u-color-light">
//                         <time class="entry__published" datetime="2023-07-05T06:00:00-07:00">July 5, 2023</time>
//                         <span class="entry__separator">|</span> <span>Author:  Jimmy Song</span></p>
//                     <div class="o-button-group"></div>
// <div class="entry__content">

const sourcedir = path.join('build', 'snarfed')
const turndownService = new TurndownService()

async function main() {
    const todo = [sourcedir]
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
                        const translated = item.replace('index.html', 'index.md').replace('snarfed', 'translated')
                        await translate(item, translated)

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

async function translate(inpath: string, outpath: string) {
    let title = ''
    let author = ''
    let date = new Date()
    const outdir = path.dirname(outpath)
    console.log(`translate(): inpath: ${inpath}, outpath: ${outpath}, outdir: ${outdir}`)
    try {
        await fs.stat(outdir)
    } catch (e) {
        await fs.mkdir(outdir, {recursive: true})
    }
    const html = (await fs.readFile(inpath)).toString()
    const dom = new JSDOM(html)
    const doc = dom.window.document
    const h1 = doc.querySelector('h1')
    if (h1 && h1.textContent) {
        title = h1.textContent?.trim()
    }
    console.log(`  TITLE: ${title}`)


    const published = doc.querySelector('time.entry__published')
    if (published && published.hasAttribute('datetime')) {
        const datetime = published.getAttribute('datetime')
        if (datetime) {
            date = new Date(Date.parse(datetime))
        }
    }
    console.log(`  DATE : ${date}`)

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
    const entry = doc.querySelector('div.entry__content')
    if (entry) {
        const images = entry.querySelectorAll('img')
        if (images) {
            for (const image of images) {
                let src = image.src
                if (src && src.startsWith('/')) {
                    src = 'https://tetrate.io' + src
                    const imageUrl = new URL(src)
                    console.log(`  fetching image: ${imageUrl}`)
                    let filename = path.basename(imageUrl.pathname)
                    const outfile = path.join(outdir.replace('translated', 'static'), filename)
                    try {
                        await fs.stat(outfile)
                        console.log(`  IMAGE CACHE HIT: ${outfile}`)
                    } catch (e) {
                        console.log(`  IMAGE CACHE MISS: ${outfile}`)
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
                    image.src = outfile.replace('build/static', '')
                }
            }
        }
        const markdown = turndownService.turndown(entry.innerHTML)
        await fs.writeFile(outpath, markdown)
    } else {
        console.error('BARF: NO entry content')
    }
}

main().then(() => {
    console.log('Done.')
})