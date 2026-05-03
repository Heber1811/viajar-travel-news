const fs = require("fs");
const path = require("path");

const root = process.cwd();
const imageExt = /\.(png|jpe?g|webp|gif|svg|ico)(\?|#|$)/i;
const skipRef = /^(https?:|data:|#|mailto:|tel:|javascript:)/i;

function cleanRef(ref) {
    let clean = ref
        .trim()
        .replace(/^['"]|['"]$/g, "")
        .replace(/\\ /g, " ")
        .replace(/\\,/g, ",")
        .replace(/\\/g, "")
        .split(/[?#]/)[0]
        .replace(/^\.\//, "");

    try {
        clean = decodeURIComponent(clean);
    } catch {
        // Keep the original string when it is not valid URL encoding.
    }

    return clean;
}

function refsFromHtml(html) {
    html = html
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");

    const refs = [];

    for (const match of html.matchAll(/<(?:img|source|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)) {
        refs.push(match[1]);
    }

    for (const match of html.matchAll(/url\((?:["']?)(.*?)(?:["']?)\)/gi)) {
        refs.push(match[1]);
    }

    return refs;
}

const rows = [];

for (const file of fs.readdirSync(root).filter((name) => name.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    const seen = new Set();

    for (const ref of refsFromHtml(html)) {
        if (!ref || skipRef.test(ref) || !imageExt.test(ref)) continue;

        const clean = cleanRef(ref);
        const key = `${file}\0${clean}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (!fs.existsSync(path.join(root, clean))) {
            rows.push({ file, ref, clean });
        }
    }
}

const byFile = new Map();
for (const row of rows) {
    byFile.set(row.file, (byFile.get(row.file) || 0) + 1);
}

for (const [file, count] of [...byFile.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.error(`${file} TOTAL ${count}`);
}

for (const row of rows) {
    console.log(`${row.file}\t${row.ref}\t=> ${row.clean}`);
}

console.error(`BROKEN_TOTAL ${rows.length}`);
console.error(`PAGES_WITH_BROKEN ${byFile.size}`);

process.exit(rows.length ? 1 : 0);
