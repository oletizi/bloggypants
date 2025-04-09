import fs from 'fs/promises'
import path from 'node:path'
//<div id="site-content
//  <h1 class="c-heading u-font-h2 u-color-light">
//                     <p class="u-fz-h6 u-color-light">
//                         <time class="entry__published" datetime="2023-07-05T06:00:00-07:00">July 5, 2023</time>
//                         <span class="entry__separator">|</span> <span>Author:  Jimmy Song</span></p>
//                     <div class="o-button-group"></div>
// <div class="entry__content">

const sourcedir = path.join('build', 'snarfed')
const targetdir = path.join('build', 'translated')

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
                        console.log(`Got one: ${item}`)
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
    console.log(`translate(): inpath: ${inpath}, outpath: ${outpath}`)
}

main().then(() => {
    console.log('Done.')
})