(function () {
    "use strict";

    const MAX_RESULTS = 10;
    const openButton = document.getElementById("openPageSearch");
    const closeButton = document.getElementById("closePageSearch");
    const panel = document.getElementById("pageSearchPanel");
    const form = document.getElementById("pageSearchForm");
    const input = document.getElementById("pageSearchInput");
    const notice = document.getElementById("siteSearchNotice");
    const results = document.getElementById("siteSearchResults");
    let searchIndex = null;
    let indexPromise = null;

    function normalizeText(text) {
        return text.toLocaleLowerCase("pt-BR")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function scrollToSearchTerm() {
        const query = new URLSearchParams(window.location.search).get("busca")?.trim();
        if (!query) return;

        const normalizedQuery = normalizeText(query);
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!parent || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                if (parent.closest("#pageSearchPanel, script, style, nav, header, footer")) {
                    return NodeFilter.FILTER_REJECT;
                }
                return normalizeText(node.nodeValue).includes(normalizedQuery)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        });

        const match = walker.nextNode();
        if (!match) return;

        const target = match.parentElement;
        target.style.backgroundColor = "rgba(255, 235, 59, 0.55)";
        target.style.borderRadius = "4px";
        target.style.transition = "background-color 0.8s ease";
        target.scrollIntoView({ behavior: "smooth", block: "center" });

        window.setTimeout(() => {
            target.style.backgroundColor = "transparent";
        }, 4000);
    }

    function loadIndex() {
        if (searchIndex) return Promise.resolve(searchIndex);
        if (!indexPromise) {
            indexPromise = fetch("search-index.json")
                .then(response => {
                    if (!response.ok) throw new Error("Não foi possível carregar o índice.");
                    return response.json();
                })
                .then(pages => {
                    searchIndex = pages.map(page => ({
                        ...page,
                        normalizedTitle: normalizeText(page.title),
                        normalizedContent: normalizeText(page.content)
                    }));
                    return searchIndex;
                })
                .catch(error => {
                    indexPromise = null;
                    throw error;
                });
        }
        return indexPromise;
    }

    function setOpen(isOpen) {
        panel.classList.toggle("open", isOpen);
        panel.setAttribute("aria-hidden", String(!isOpen));
        if (isOpen) {
            input.focus();
            loadIndex().catch(() => {
                notice.textContent = "Não foi possível carregar a busca. Tente novamente.";
            });
        }
    }

    function makeSnippet(content, normalizedQuery, terms) {
        const normalizedContent = normalizeText(content);
        let position = normalizedContent.indexOf(normalizedQuery);
        if (position < 0) position = normalizedContent.indexOf(terms[0]);
        const start = Math.max(0, position < 0 ? 0 : position - 85);
        const end = Math.min(content.length, start + 230);
        return `${start > 0 ? "…" : ""}${content.slice(start, end).trim()}${end < content.length ? "…" : ""}`;
    }

    function findPages(query) {
        const normalizedQuery = normalizeText(query);
        const terms = normalizedQuery.split(" ").filter(Boolean);

        return searchIndex
            .map(page => {
                const titleMatches = terms.every(term => page.normalizedTitle.includes(term));
                const contentMatches = terms.every(term => page.normalizedContent.includes(term));
                if (!titleMatches && !contentMatches) return null;

                let score = 0;
                if (page.normalizedTitle === normalizedQuery) score += 100;
                if (page.normalizedTitle.includes(normalizedQuery)) score += 50;
                if (titleMatches) score += 25;
                if (page.normalizedContent.includes(normalizedQuery)) score += 10;
                return { page, score, snippet: makeSnippet(page.content, normalizedQuery, terms) };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title, "pt-BR"));
    }

    function renderResults(matches, query) {
        results.replaceChildren();
        const fragment = document.createDocumentFragment();
        const textFragment = encodeURIComponent(query.trim());

        matches.slice(0, MAX_RESULTS).forEach(match => {
            const link = document.createElement("a");
            const title = document.createElement("strong");
            const snippet = document.createElement("span");
            const separator = match.page.url.includes("?") ? "&" : "?";
            link.className = "site-search-result";
            link.href = `${match.page.url}${separator}busca=${textFragment}#:~:text=${textFragment}`;
            title.textContent = match.page.title;
            snippet.textContent = match.snippet;
            link.append(title, snippet);
            fragment.appendChild(link);
        });
        results.appendChild(fragment);
    }

    openButton?.addEventListener("click", event => {
        event.stopPropagation();
        setOpen(true);
    });
    closeButton?.addEventListener("click", () => setOpen(false));
    document.addEventListener("click", event => {
        if (panel.classList.contains("open") && !panel.contains(event.target) && event.target !== openButton) {
            setOpen(false);
        }
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && panel.classList.contains("open")) setOpen(false);
    });

    form?.addEventListener("submit", async event => {
        event.preventDefault();
        const query = input.value.trim();
        results.replaceChildren();
        if (query.length < 2) {
            notice.textContent = "Digite pelo menos 2 caracteres.";
            return;
        }

        notice.textContent = "Pesquisando em todo o site…";
        try {
            await loadIndex();
            const matches = findPages(query);
            renderResults(matches, query);
            notice.textContent = matches.length
                ? `${matches.length} ${matches.length === 1 ? "página encontrada" : "páginas encontradas"}${matches.length > MAX_RESULTS ? ` — exibindo ${MAX_RESULTS}` : ""}.`
                : "Nenhum resultado encontrado.";
        } catch (_) {
            notice.textContent = "Não foi possível carregar a busca. Tente novamente.";
        }
    });

    input?.addEventListener("input", () => {
        notice.textContent = "Digite e pressione Enter";
        if (!input.value.trim()) results.replaceChildren();
    });

    window.setTimeout(scrollToSearchTerm, 250);
})();
