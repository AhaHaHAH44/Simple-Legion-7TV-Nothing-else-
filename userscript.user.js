// ==UserScript==
// @name         Simple Legion 7TV
// @namespace    https://github.com/AhaHaHAH44/Simple-Legion-7TV-Nothing-else-
// @version      1.0.0
// @description  Minimal 7TV emote support for Legion Game
// @author       Sectwi1l
// @homepageURL  https://github.com/AhaHaHAH44/Simple-Legion-7TV-Nothing-else-
// @supportURL   https://github.com/AhaHaHAH44/Simple-Legion-7TV-Nothing-else-/issues
// @updateURL    https://raw.githubusercontent.com/AhaHaHAH44/Simple-Legion-7TV-Nothing-else-/main/userscript.user.js
// @downloadURL  https://raw.githubusercontent.com/AhaHaHAH44/Simple-Legion-7TV-Nothing-else-/main/userscript.user.js
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
        cacheKey: 'simpleLegion7TV_cache_v3',
        cacheTime: 6 * 60 * 60 * 1000,
        channel: 'ZakvielChannel',
        twitchId: '44407373',

        chat: '.cy-chat-l',
        input: 'form.cy-chat-f input[type="text"]',
        form: 'form.cy-chat-f'
    };

    let emotes = new Map();
    let emoteNames = [];
    let picker = null;
    let observer = null;
    let observedChat = null;
    let imageCache = new Map();
    let imageRequests = new Map();

    // ==========================================
    // LOAD EMOTES
    // ==========================================

    function requestJson(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 15000,
    
                onload(response) {
                    if (response.status !== 200) {
                        reject(new Error(`HTTP ${response.status}`));
                        return;
                    }
    
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch (error) {
                        reject(error);
                    }
                },
    
                onerror() {
                    reject(new Error('Ошибка соединения с 7TV'));
                },
    
                ontimeout() {
                    reject(new Error('Превышено время ожидания 7TV'));
                }
            });
        });
    }

    async function loadEmotes() {
        try {
            console.log('[7TV] Loading global emotes...');
    
            const globalData = await requestJson(CONFIG.api);
    
            if (!Array.isArray(globalData.emotes)) {
                throw new Error('Invalid global emote response');
            }
    
            let channelEmotes = [];
    
            try {
                console.log(`[7TV] Loading channel: ${CONFIG.channel}`);
            
                const connectionData = await requestJson(
                    `https://7tv.io/v3/users/twitch/${CONFIG.twitchId}`
                );
            
                let channelSet = connectionData.emote_set;
            
                // Если API вернул только ID набора
                if (!channelSet && connectionData.emote_set_id) {
                    channelSet = await requestJson(
                        `https://7tv.io/v3/emote-sets/${connectionData.emote_set_id}`
                    );
                }
            
                // Дополнительная проверка альтернативного поля
                if (!channelSet && connectionData.emote_sets?.length) {
                    channelSet = connectionData.emote_sets[0];
                }
            
                if (!channelSet) {
                    throw new Error('Channel emote set not found');
                }
            
                channelEmotes = channelSet.emotes || [];
            
                console.log(
                    `[7TV] ${CONFIG.channel} emotes: ${channelEmotes.length}`
                );
            
            } catch (error) {
                console.warn('[7TV] Channel emotes unavailable:', error);
            }
    
            // Global + channel emotes.
            // Channel emotes take priority when names match.
            const combined = new Map();
    
            for (const emote of globalData.emotes) {
                combined.set(emote.name, emote);
            }
    
            for (const emote of channelEmotes) {
                combined.set(emote.name, emote);
            }
    
            const allEmotes = [...combined.values()];
    
            setEmotes(allEmotes);
    
            localStorage.setItem(CONFIG.cacheKey, JSON.stringify({
                time: Date.now(),
                emotes: allEmotes
            }));
    
            console.log(`[7TV] Total emotes: ${emotes.size}`);
    
        } catch (error) {
            console.error('[7TV] Loading failed:', error);
        }
    }
    
    function setEmotes(list) {
        emotes.clear();
    
        for (const item of list) {
            const data = item.data || item;
            const name = item.name || data.name;
            const id = data.id || item.id;
            const host = data.host || item.host;
    
            if (!id || !name) continue;
    
            let imageUrl = null;
    
            if (host?.url && Array.isArray(host.files)) {
                const preferred = [
                    '2x.webp',
                    '2x.avif',
                    '2x.gif',
                    '2x.png',
                    '1x.webp',
                    '1x.avif',
                    '1x.gif',
                    '1x.png'
                ];
    
                const file = preferred
                    .map(filename => host.files.find(f => f.name === filename))
                    .find(Boolean);
    
                if (file) {
                    imageUrl = `${host.url.replace(/\/$/, '')}/${file.name}`;
                }
            }
    
            if (!imageUrl) {
                imageUrl = `${CONFIG.cdn}${id}/2x`;
            }
    
            emotes.set(name, {
                id,
                name,
                url: imageUrl
            });
        }
    
        emoteNames = [...emotes.keys()]
            .sort((a, b) => b.length - a.length);
    
        console.log(`[7TV] Prepared ${emotes.size} emotes`);
    }
    
    function getEmoteUrl(emote) {
        return emote.url;
    }

    function loadEmoteImage(url) {
        if (imageCache.has(url)) {
            return Promise.resolve(imageCache.get(url));
        }
    
        if (imageRequests.has(url)) {
            return imageRequests.get(url);
        }
    
        const request = new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'blob',
                timeout: 20000,
    
                onload(response) {
                    if (response.status !== 200 || !response.response) {
                        reject(new Error(`Image HTTP ${response.status}`));
                        return;
                    }
    
                    const blob = response.response instanceof Blob
                        ? response.response
                        : new Blob([response.response]);
    
                    if (!blob.type.startsWith('image/')) {
                        reject(new Error('Invalid image response'));
                        return;
                    }
    
                    const blobUrl = URL.createObjectURL(blob);
    
                    imageCache.set(url, blobUrl);
                    resolve(blobUrl);
                },
    
                onerror() {
                    reject(new Error('Image download failed'));
                },
    
                ontimeout() {
                    reject(new Error('Image download timeout'));
                }
            });
        });
    
        imageRequests.set(url, request);
    
        request.finally(() => {
            imageRequests.delete(url);
        }).catch(() => {});
    
        return request;
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
                    loadEmoteImage(getEmoteUrl(emote))
                        .then(url => {
                            img.src = url;
                        })
                        .catch(error => {
                            console.warn(`[7TV] Failed to load ${name}:`, error);
                        });
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
            .s7tv-input-wrap {
            position: relative !important;
            flex: 1 1 auto !important;
            min-width: 0 !important;
            display: flex !important;
            align-items: center !important;
        }
        
        .s7tv-input-wrap input {
            width: 100% !important;
            min-width: 0 !important;
            padding-right: 48px !important;
        }
        
        .s7tv-picker-button {
            position: absolute !important;
            right: 7px !important;
            top: 50% !important;
            transform: translateY(-50%) !important;
        
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
        
            width: auto !important;
            height: auto !important;
            min-width: 0 !important;
        
            padding: 3px 4px !important;
            margin: 0 !important;
        
            background: transparent !important;
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
        
            color: inherit !important;
            font-size: 12px !important;
            font-weight: 600 !important;
            opacity: 0.65;
        
            cursor: pointer;
            transition: opacity .15s;
        }
        
        .s7tv-picker-button:hover {
            background: transparent !important;
            opacity: 1;
        }
        
        .s7tv-picker {
            position: absolute !important;
            z-index: 999999 !important;
        
            right: 0 !important;
            bottom: calc(100% + 8px) !important;
        
            width: 280px !important;
            max-height: 350px !important;
            padding: 10px !important;
        
            background: #202127 !important;
            color: #fff !important;
        
            border: 1px solid rgba(255,255,255,.12) !important;
            border-radius: 9px !important;
            box-shadow: 0 5px 25px rgba(0,0,0,.4) !important;
        
            display: flex;
            flex-direction: column;
            gap: 9px;
        }
        
        .s7tv-picker[hidden] {
            display: none !important;
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
            appearance: none !important;
            -webkit-appearance: none !important;
        
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        
            width: 100% !important;
            height: 43px !important;
            padding: 3px !important;
        
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
            border-radius: 6px !important;
        
            background: transparent !important;
            color: #fff !important;
        
            cursor: pointer;
        }
        
        .s7tv-item:hover {
            background: rgba(255,255,255,.12) !important;
        }
        
        .s7tv-item img {
            display: block !important;
            max-width: 38px !important;
            max-height: 36px !important;
            object-fit: contain;
            background: transparent !important;
        }
        
        .s7tv-empty {
            color: #999;
            font-size: 12px;
            text-align: center;
            padding: 15px 0;
            grid-column: 1 / -1;
        }

        .s7tv-emote {
            display: inline-block !important;
            width: auto !important;
            height: 1.35em !important;
            max-width: 3em !important;
            max-height: 1.35em !important;
            vertical-align: -0.25em !important;
            object-fit: contain !important;
            margin: 0 2px !important;
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
        
        const wrapper = document.createElement('div');
        wrapper.className = 's7tv-input-wrap';
        
        form.insertBefore(wrapper, input);
        
        wrapper.appendChild(input);
        wrapper.appendChild(button);
        
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
                loadEmoteImage(getEmoteUrl(emote))
                    .then(url => {
                        img.src = url;
                    })
                    .catch(error => {
                        console.warn(`[7TV] Failed to load ${name}:`, error);
                        img.alt = 'Ошибка загрузки';
                    });
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
