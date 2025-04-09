import * as fs from 'fs/promises'
import {XMLParser} from 'fast-xml-parser'
import path from 'node:path'

const outdir = path.join('build', 'snarfed')

async function main() {
    try {
        await fs.stat(outdir)
    } catch (e) {
        await fs.mkdir(outdir)
    }

    let sitemap = (await fs.readFile('sitemap.xml')).toString()
    const doc = new XMLParser().parse(sitemap, {})
    const urlset = doc.urlset
    for (const i of urlset.url) {
        const url = new URL(i.loc)
        const outfile = path.join(outdir, url.pathname + 'index.html')
        const dir = path.dirname(outfile)
        try {
            await fs.stat(dir)
        } catch (e) {
            await fs.mkdir(dir, {recursive: true})
        }

        try {
            await fs.stat(outfile)
            console.log(`CACHE HIT: ${outfile}`)
        } catch (e) {
            console.log(`CACHE MISS: ${outfile}`)
            console.log(`fetching ${url}`)
            const res = await fetch(url)
            if (res.ok) {
                console.log(`  ok. Will save to ${outfile}`)
                await fs.writeFile(outfile, await res.text())
            } else {
                console.error(`  Barf: ${res.status} ${res.statusText}`)
            }
        }
    }
}


main().then(() => console.log('Done.'))
