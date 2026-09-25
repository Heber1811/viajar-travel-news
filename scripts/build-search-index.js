const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "search-index.json");
const excludedPages = new Set([
    "metricas.html",
    "paginas.html",
    "perfil.html"
]);

const entities = {
    amp: "&", apos: "'", copy: "©", gt: ">", laquo: "«", ldquo: "“",
    lsquo: "‘", lt: "<", mdash: "—", nbsp: " ", ndash: "–", quot: '"',
    raquo: "»", rdquo: "”", reg: "®", rsquo: "’"
};

function decodeEntities(text) {
    return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
        if (code[0] === "#") {
            const isHex = code[1].toLowerCase() === "x";
            const value = parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
            return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
        }
        return entities[code.toLowerCase()] ?? entity;
    });
}

function cleanText(html) {
    return decodeEntities(html
        .replace(/<!--([\s\S]*?)-->/g, " ")
        .replace(/<(script|style|svg|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote|\/figcaption|\/td|\/th)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim());
}

function firstMatch(html, patterns) {
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) return cleanText(match[1]);
    }
    return "";
}

function pageTitle(html, filename) {
    if (filename === "index.html") return "Viajar Travel News — Página inicial";

    const title = firstMatch(html, [
        /<h[1-2]\b[^>]*class=["'][^"']*\bheading\b[^"']*["'][^>]*>([\s\S]*?)<\/h[1-2]>/i,
        /<h1\b[^>]*>([\s\S]*?)<\/h1>/i,
        /<title\b[^>]*>([\s\S]*?)<\/title>/i
    ]);

    if (title && !/^viajar travel news$/i.test(title)) return title;
    return filename
        .replace(/\.html$/i, "")
        .split("-")
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

const pages = fs.readdirSync(root)
    .filter(filename => filename.endsWith(".html") && !excludedPages.has(filename))
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map(filename => {
        const html = fs.readFileSync(path.join(root, filename), "utf8");
        const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
        return {
            title: pageTitle(body, filename),
            url: filename,
            content: cleanText(body)
        };
    })
    .filter(page => page.content.length > 0);

fs.writeFileSync(output, `${JSON.stringify(pages)}\n`, "utf8");
console.log(`Índice criado com ${pages.length} páginas: ${path.relative(root, output)}`);
