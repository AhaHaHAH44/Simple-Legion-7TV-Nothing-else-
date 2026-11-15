// ==UserScript==
// @name         Simple Legion 7TV
// @namespace    https://github.com/AhaHaHAH44/Simple-Legion-7TV-Nothing-else-
// @version      1.0.0
// @description  Minimal 7TV emote support for Legion Game
// @author       Sectwi1l
// @homepageURL  https://github.com/AhaHaHAH44/Simple-Legion-7TV-Nothing-else-
// @supportURL   https://github.com/AhaHaHAH44/Simple-Legion-7TV-Nothing-else-/issues
// @updateURL    https://raw.githubusercontent.com/AhaHaHAH44/Simple-Legion-7TV-Nothing-else-/main/userscript.js
// @downloadURL  https://raw.githubusercontent.com/AhaHaHAH44/Simple-Legion-7TV-Nothing-else-/main/userscript.js
// @match        https://legiongame.gg/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @connect      7tv.io
// @connect      cdn.7tv.app
// @connect      raw.githubusercontent.com
// ==/UserScript==

(() => {
    'use strict';

    // ==========================================
    // CONFIG
    // ==========================================

    const CONFIG = {
        api: 'https://7tv.io/v3/emote-sets/global',
        cdn: 'https://cdn.7tv.app/emote/',
        cacheKey: 'simpleLegion7TV_cache',
        cacheTime: 6 * 60 * 60 * 1000,

        chat: '.cy-chat-l',
        input: 'form.cy-chat-f input[type="text"]',
        form: 'form.cy-chat-f'
    };

    let emotes = new Map();
    let emoteNames = [];
    let picker = null;
    let observer = null;
    let observedChat = null;

    // ==========================================
    // LOAD EMOTES
    // ==========================================

    async function loadEmotes() {
        try {
            const cached = localStorage.getItem(CONFIG.cacheKey);

            if (cached) {
                const data = JSON.parse(cached);

                if (
                    Date.now() - data.time < CONFIG.cacheTime &&
                    Array.isArray(data.emotes)
                ) {
                    setEmotes(data.emotes);
                    return;
                }
            }
        } catch (error) {
            console.warn('[7TV] Cache error:', error);
        }

        try {
            const response = await fetch(CONFIG.api);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!Array.isArray(data.emotes)) {
                throw new Error('Invalid 7TV response');
            }

            setEmotes(data.emotes);

            localStorage.setItem(CONFIG.cacheKey, JSON.stringify({
                time: Date.now(),
                emotes: data.emotes
            }));

            console.log(`[7TV] Loaded ${emotes.size} emotes`);
        } catch (error) {
            console.error('[7TV] Loading failed:', error);
        }
    }

    function setEmotes(list) {
        emotes.clear();

        for (const item of list) {
            const emote = item.data || item;

            if (!emote.id || !item.name && !emote.name) continue;

            const name = item.name || emote.name;

            emotes.set(name, {
                id: emote.id,
                name
            });
        }

        emoteNames = [...emotes.keys()]
            .sort((a, b) => b.length - a.length);
    }

    function getEmoteUrl(id) {
        return `${CONFIG.cdn}${id}/2x.webp`;
    }

    // ==========================================
    // MESSAGE RENDERING
    // ==========================================

    function replaceEmotes(root) {
        if (!root || !emoteNames.length) return;

        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    const parent = node.parentElement;

                    if (!parent || !node.nodeValue.trim()) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    if (
                        parent.closest(
                            'script, style, textarea, input, button, img, a, [contenteditable="true"], .s7tv-emote'
                        )
                    ) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const nodes = [];

        while (walker.nextNode()) {
            nodes.push(walker.currentNode);
        }

        if (!nodes.length) return;

        const escaped = emoteNames
            .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');

        const regex = new RegExp(
            `(^|[\\s([{])(${escaped})(?=$|[\\s.,!?;:)\\]}])`,
            'g'
        );

        for (const node of nodes) {
            const text = node.nodeValue;

            if (!regex.test(text)) {
                regex.lastIndex = 0;
                continue;
            }

            regex.lastIndex = 0;

            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let match;

            while ((match = regex.exec(text)) !== null) {
                const prefix = match[1];
                const name = match[2];
                const start = match.index;

                if (start > lastIndex) {
                    fragment.appendChild(
                        document.createTextNode(
                            text.slice(lastIndex, start)
                        )
                    );
                }

                if (prefix) {
                    fragment.appendChild(
                        document.createTextNode(prefix)
                    );
                }

                const emote = emotes.get(name);

                if (emote) {
                    const img = document.createElement('img');

                    img.className = 's7tv-emote';
                    img.src = getEmoteUrl(emote.id);
                    img.alt = name;
                    img.title = name;
                    img.loading = 'lazy';
                    img.draggable = false;

                    fragment.appendChild(img);
                }

                lastIndex = regex.lastIndex;
            }

            if (lastIndex < text.length) {
                fragment.appendChild(
                    document.createTextNode(text.slice(lastIndex))
                );
            }

            if (fragment.childNodes.length) {
                node.replaceWith(fragment);
            }
        }
    }

    function processChat() {
        const chat = document.querySelector(CONFIG.chat);

        if (chat) replaceEmotes(chat);
    }

    // ==========================================
    // STYLES
    // ==========================================

    function addStyles() {
        const style = document.createElement('style');

        style.textContent = `
            .s7tv-emote {
                display: inline-block;
                width: auto;
                height: 1.8em;
                max-width: 4em;
                vertical-align: middle;
                object-fit: contain;
                margin: 0 2px;
            }

            .s7tv-picker-button {
                flex: 0 0 auto;
                background: transparent;
                border: none;
                outline: none;
                box-shadow: none;
                color: inherit;
                opacity: 0.65;
                cursor: pointer;
                font-size: 12px;
                font-weight: 600;
                padding: 0 9px;
                margin: 0;
                transition: opacity .15s;
            }
            
            .s7tv-picker-button:hover {
                opacity: 1;
            }
            
            .s7tv-picker {
                position: absolute;
                z-index: 999999;
                right: 38px;
                bottom: calc(100% + 8px);
            }

            .s7tv-picker[hidden] {
                display: none;
            }

            .s7tv-search {
                width: 100%;
                box-sizing: border-box;
                padding: 8px 10px;
                border: 1px solid #41434c;
                border-radius: 6px;
                outline: none;
                background: #292b33;
                color: #fff;
                font-size: 13px;
            }

            .s7tv-grid {
                display: grid;
                grid-template-columns: repeat(5, 1fr);
                gap: 5px;
                overflow-y: auto;
                min-height: 0;
            }

            .s7tv-item {
                display: flex;
                align-items: center;
                justify-content: center;
                height: 43px;
                border: none;
                border-radius: 6px;
                background: transparent;
                cursor: pointer;
            }

            .s7tv-item:hover {
                background: rgba(255,255,255,.12);
            }

            .s7tv-item img {
                max-width: 38px;
                max-height: 36px;
                object-fit: contain;
            }

            .s7tv-empty {
                color: #999;
                font-size: 12px;
                text-align: center;
                padding: 15px 0;
                grid-column: 1 / -1;
            }
        `;

        document.head.appendChild(style);
    }

    // ==========================================
    // EMOTE PICKER
    // ==========================================

    function createPicker() {
        const form = document.querySelector(CONFIG.form);
        const input = document.querySelector(CONFIG.input);

        if (!form || !input) return;
        if (form.querySelector('.s7tv-picker-button')) return;

        const button = document.createElement('button');

        button.type = 'button';
        button.className = 's7tv-picker-button';
        button.title = '7TV Emotes';
        button.textContent = '7TV';

        const panel = document.createElement('div');

        panel.className = 's7tv-picker';
        panel.hidden = true;

        const search = document.createElement('input');

        search.className = 's7tv-search';
        search.placeholder = 'Поиск смайлика...';
        search.type = 'text';

        const grid = document.createElement('div');

        grid.className = 's7tv-grid';

        panel.append(search, grid);

        const submitButton = form.querySelector('button[type="submit"]');

        if (!submitButton) return;
        
        if (getComputedStyle(form).position === 'static') {
            form.style.position = 'relative';
        }
        
        // Кнопка 7TV между полем ввода и отправкой
        form.insertBefore(button, submitButton);
        
        // Окно выбора смайликов
        form.appendChild(panel);

        function renderGrid(query = '') {
            grid.replaceChildren();

            const filtered = emoteNames
                .filter(name => name.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 150);

            if (!filtered.length) {
                const empty = document.createElement('div');
                empty.className = 's7tv-empty';
                empty.textContent = 'Смайлики не найдены';
                grid.appendChild(empty);
                return;
            }

            for (const name of filtered) {
                const emote = emotes.get(name);

                const item = document.createElement('button');
                item.type = 'button';
                item.className = 's7tv-item';
                item.title = name;

                const img = document.createElement('img');
                img.src = getEmoteUrl(emote.id);
                img.alt = name;
                img.loading = 'lazy';

                item.appendChild(img);

                item.addEventListener('click', () => {
                    const start = input.selectionStart ?? input.value.length;
                    const end = input.selectionEnd ?? start;

                    const before = input.value.slice(0, start);
                    const after = input.value.slice(end);

                    const separator = before && !/\s$/.test(before)
                        ? ' '
                        : '';

                    input.value = before + separator + name + after;

                    const cursor = (before + separator + name).length;

                    input.focus();
                    input.setSelectionRange(cursor, cursor);
                    input.dispatchEvent(new Event('input', {
                        bubbles: true
                    }));

                    panel.hidden = true;
                });

                grid.appendChild(item);
            }
        }

        button.addEventListener('click', () => {
            panel.hidden = !panel.hidden;

            if (!panel.hidden) {
                renderGrid();
                search.value = '';
                search.focus();
            }
        });

        search.addEventListener('input', () => {
            renderGrid(search.value);
        });

        document.addEventListener('click', event => {
            if (
                !panel.contains(event.target) &&
                !button.contains(event.target)
            ) {
                panel.hidden = true;
            }
        });

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                panel.hidden = true;
            }
        });
    }

    // ==========================================
    // OBSERVER
    // ==========================================

    function startObserver() {
        if (observer) observer.disconnect();

        const chat = document.querySelector(CONFIG.chat);
        observedChat = chat;

        if (!chat) return;

        processChat();

        observer = new MutationObserver(() => {
            processChat();
        });

        observer.observe(chat, {
            childList: true,
            subtree: true
        });
    }

    // ==========================================
    // INIT
    // ==========================================

    async function init() {
        addStyles();

        await loadEmotes();

        processChat();
        createPicker();
        startObserver();

        console.log('[7TV] Simple Legion 7TV initialized');

        // MultiDonate can recreate chat elements.
        setInterval(() => {
            createPicker();

            const chat = document.querySelector(CONFIG.chat);

            if (chat && (!observer || !observerRootIs(chat))) {
                startObserver();
            }
        }, 2000);
    }

    function observerRootIs(chat) {
        return observer && observedChat === chat && chat.isConnected;
    }

    init();

})();
