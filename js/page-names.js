const KNOWN_PAGES = {
    '/': 'Página inicial',
    '/index.html': 'Página inicial',
    '/arquivo.html': 'Arquivo de matérias',
    '/galeria.html': 'Galeria',
    '/pessoas-vtn.html': 'Pessoas VTN'
};

function titleFromPath(path) {
    const url = new URL(path || '/', 'https://viajartravelnews.com.br');
    if (KNOWN_PAGES[url.pathname]) return KNOWN_PAGES[url.pathname];

    if (url.pathname === '/paginas.html') {
        const id = url.searchParams.get('id');
        return id ? `Matéria ${id}` : 'Matéria sem identificação';
    }

    const filename = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    return filename
        .replace(/\.html?$/i, '')
        .replaceAll('-', ' ')
        .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase('pt-BR'))
        || 'Página inicial';
}

export function friendlyPageName(path, storedTitle = '') {
    const url = new URL(path || '/', 'https://viajartravelnews.com.br');
    if (KNOWN_PAGES[url.pathname]) return KNOWN_PAGES[url.pathname];

    const cleanTitle = String(storedTitle).trim();
    if (cleanTitle && cleanTitle.toLocaleLowerCase('pt-BR') !== 'viajar travel news') {
        return cleanTitle;
    }
    return titleFromPath(path);
}
