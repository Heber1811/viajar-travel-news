const KNOWN_PAGES = {
    '/': 'Página inicial',
    '/index.html': 'Página inicial',
    '/arquivo.html': 'Arquivo de matérias',
    '/galeria.html': 'Galeria',
    '/pessoas-vtn.html': 'Pessoas VTN'
};

const DYNAMIC_PAGE_TITLES = {
    1: 'CARLOS BARBOSA | RS',
    2: 'GARIBALDI | RS',
    3: 'JALAPÃO | TO',
    4: 'MACAÉ | RJ',
    5: 'CHAPADA DOS VEADEIROS | GO',
    6: 'PROTEÇÃO AOS ANIMAIS',
    7: 'GOIÁS VELHO',
    8: 'CORA CORALINA',
    9: 'SANTUÁRIO ECOLÓGICO POÇO DO SUCURI',
    10: 'TEATRO BOUTIQUE MARIE PADILLE',
    11: 'ALAGOA, MG',
    12: 'ITAMONTE, MG',
    13: 'SÃO BENTO DO SAPUCAÍ, SP',
    14: 'PENEDO, RJ',
    15: 'VISCONDE DE MAUÁ, RJ',
    16: 'FLORIANÓPOLIS, UMA CIDADE VIBRANTE',
    18: 'LAGOA DA CONCEIÇÃO',
    19: 'POUSADA COSTA SOLAR',
    20: 'NAVEGANDO PELAS ÁGUAS DA COSTA E DA BARRA DA LAGOA',
    21: 'CONEXÃO PIRI CONECTA. VOCÊ VIVENCIA.',
    22: 'VIVA O MELHOR DE PIRI!',
    23: 'DO CERRADO AO PALADAR',
    24: 'ENTRE O BARRO E A ALMA',
    25: 'PIRENÓPOLIS: ONDE SE HOSPEDAR VIRA EXPERIÊNCIA',
    26: 'DOMIGOS MARTINS, ONDE COMEÇA A VIAGEM...',
    27: 'PEDRA AZUL E A ROTA DO LAGARTO',
    28: 'DO CAMPO AO COPO: UM ROTEIRO CERVEJEIRO',
    29: 'POUSADA RABO DO LAGARTO',
    30: 'VITÓRIA E VILA VELHA, ES',
    31: 'TRANSPANTANEIRA: VIDA SELVAGEM SEM FILTROS',
    32: 'DE TREM ATÉ MORRETES',
    33: 'VOANDO DE BALÃO NO ACRE: O DESPERTAR DA AMAZÔNIA POR OUTRO ÂNGULO',
    34: 'O LOBO-GUARÁ E O SANTUÁRIO DO CARAÇA',
    35: 'A IMPRESSIONANTE SERRA DO RIO DO RASTRO',
    36: 'VOLTA AO MUNDO 2028: UMA JORNADA ÉPICA',
    37: 'NA TERRA DO FOGO A BORDO DO COSTA SERENA',
    38: 'COSTA CRUZEIROS TRAZ O ESPÍRITO DO CARIBE COM O NOVO PROGRAMA “ALMA LATINA”',
    39: 'VERÃO EUROPEU 2026: ENCANTE-SE NAS FÉRIAS A BORDO COM A COSTA CRUZEIROS',
    40: 'NOVEMBRO DE 2026: EUROPA-BRASIL NO COSTA DIADEMA',
    41: 'ROTEIRO MÍSTICO E DE CHARME',
    42: 'MAGIA, CONFORTO, NATUREZA',
    43: 'SABORES DA TERRA',
    44: 'O CHARME COLONIAL E MÍSTICO DO CENTRO HISTÓRICO DE LENÇÓIS',
    45: 'ROTEIRO PERFEITO'
};

function titleFromPath(path) {
    const url = new URL(path || '/', 'https://viajartravelnews.com.br');
    if (KNOWN_PAGES[url.pathname]) return KNOWN_PAGES[url.pathname];

    if (url.pathname === '/paginas.html') {
        const id = url.searchParams.get('id');
        if (id && DYNAMIC_PAGE_TITLES[id]) return DYNAMIC_PAGE_TITLES[id];
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
    if (url.pathname === '/paginas.html') return titleFromPath(path);

    const cleanTitle = String(storedTitle).trim();
    if (cleanTitle && cleanTitle.toLocaleLowerCase('pt-BR') !== 'viajar travel news') {
        return cleanTitle;
    }
    return titleFromPath(path);
}
