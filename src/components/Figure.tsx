export function Figure({src, width, caption}: {src: string,  width: string, caption?: string}) {
    return (<figure>
        <img src={src} alt={caption} width={width}/>
        <figcaption>{caption}</figcaption>
    </figure>)
}
