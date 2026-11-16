// ==UserScript==
// @name         Simple Legion 7TV
// @namespace    https://github.com/AhaHaHAH44/Simple-Legion-7TV-Nothing-else-
// @version      1.5.0
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
        cacheKey: 'simpleLegion7TV_cache_v4',
        favoritesKey: 'simpleLegion7TV_favorites_v1',
        cacheTime: 6 * 60 * 60 * 1000,
        channel: 'ZakvielChannel',
        twitchId: '44407373',

        chat: '.cy-chat-l',
        input: 'form.cy-chat-f input[type="text"]',
        form: 'form.cy-chat-f'
    };

    let emotes = new Map();
    let globalEmotes = new Map();
    let channelEmotes = new Map();
    
    let emoteNames = [];
    
    let picker = null;
    let observer = null;
    let observedChats = [];
    
    let imageCache = new Map();
    let imageRequests = new Map();
    let favoriteEmotes = new Set();

    // MEOW NOTIFICATIONS
    let seenMessageIds = new Set();
    let seenMessageElements = new WeakSet();
    let pendingMessages = new WeakSet();
    let meowAudioContext = null;
    let meowAudioUnlocked = false;

    try {
        const savedFavorites = JSON.parse(
            localStorage.getItem(CONFIG.favoritesKey) || '[]'
        );
    
        if (Array.isArray(savedFavorites)) {
            favoriteEmotes = new Set(savedFavorites);
        }
    } catch (error) {
        console.warn('[7TV] Favorites loading failed:', error);
    }

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
        // Сначала пробуем использовать свежий кэш.
        try {
            const cached = JSON.parse(
                localStorage.getItem(CONFIG.cacheKey) || 'null'
            );
    
            if (
                cached &&
                Date.now() - cached.time < CONFIG.cacheTime &&
                Array.isArray(cached.globalEmotes) &&
                Array.isArray(cached.channelEmotes)
            ) {
                setEmotes(cached.globalEmotes, cached.channelEmotes);
    
                console.log('[7TV] Loaded emotes from cache');
                return;
            }
        } catch (error) {
            console.warn('[7TV] Cache unavailable:', error);
        }
    
        try {
            console.log('[7TV] Loading global emotes...');
    
            const globalData = await requestJson(CONFIG.api);
    
            if (!Array.isArray(globalData.emotes)) {
                throw new Error('Invalid global emote response');
            }
    
            let channelList = [];
    
            try {
                console.log(`[7TV] Loading channel: ${CONFIG.channel}`);
    
                const connectionData = await requestJson(
                    `https://7tv.io/v3/users/twitch/${CONFIG.twitchId}`
                );
    
                let channelSet = connectionData.emote_set;
    
                if (!channelSet && connectionData.emote_set_id) {
                    channelSet = await requestJson(
                        `https://7tv.io/v3/emote-sets/${connectionData.emote_set_id}`
                    );
                }
    
                if (!channelSet && connectionData.emote_sets?.length) {
                    channelSet = connectionData.emote_sets[0];
                }
    
                if (!channelSet) {
                    throw new Error('Channel emote set not found');
                }
    
                channelList = channelSet.emotes || [];
    
                console.log(
                    `[7TV] ${CONFIG.channel} emotes: ${channelList.length}`
                );
            } catch (error) {
                console.warn('[7TV] Channel emotes unavailable:', error);
            }
    
            setEmotes(globalData.emotes, channelList);
    
            localStorage.setItem(CONFIG.cacheKey, JSON.stringify({
                time: Date.now(),
                globalEmotes: globalData.emotes,
                channelEmotes: channelList
            }));
    
            console.log(`[7TV] Total emotes: ${emotes.size}`);
    
        } catch (error) {
            console.error('[7TV] Loading failed:', error);
        }
    }
    
    function createEmoteMap(list) {
        const result = new Map();
    
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
    
            result.set(name, {
                id,
                name,
                url: imageUrl
            });
        }
    
        return result;
    }
    
    function setEmotes(globalList, channelList) {
        globalEmotes = createEmoteMap(globalList);
        channelEmotes = createEmoteMap(channelList);
    
        // Объединяем наборы.
        // Если имя совпадает, канал имеет приоритет.
        emotes = new Map(globalEmotes);
    
        for (const [name, emote] of channelEmotes) {
            emotes.set(name, emote);
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

    function captureChatScroll() {
        const chat = document.querySelector(CONFIG.chat);
        if (!chat) return [];
    
        const states = [];
        let element = chat;
    
        while (element && element !== document.body) {
            if (element instanceof HTMLElement && element.scrollHeight > element.clientHeight + 1) {
                states.push({
                    element,
                    scrollTop: element.scrollTop,
                    distanceFromBottom:
                        element.scrollHeight - element.clientHeight - element.scrollTop
                });
            }
    
            element = element.parentElement;
        }
    
        return states;
    }
    
    function restoreChatScroll(states) {
        requestAnimationFrame(() => {
            for (const state of states) {
                const element = state.element;
    
                if (!element.isConnected) continue;
    
                // Если пользователь был внизу — сохраняем положение внизу.
                if (state.distanceFromBottom <= 40) {
                    element.scrollTop = element.scrollHeight - element.clientHeight;
                } else {
                    // Иначе возвращаем прежнюю позицию чтения.
                    element.scrollTop = state.scrollTop;
                }
            }
        });
    }

    function replaceEmotes(root) {
        if (!root || !emoteNames.length) return;
    
        const scrollStates = captureChatScroll();
        let wasChanged = false;

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
                    img.height = 28;
                    img.style.height = '28px';
                    img.style.width = 'auto';
                    img.style.maxWidth = 'none';
                    img.style.aspectRatio = 'auto';
                    img.style.objectFit = 'fill';
                    img.style.verticalAlign = 'middle';

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
                wasChanged = true;
            }
        }
        if (wasChanged) {
            restoreChatScroll(scrollStates);
        }
    }

    function highlightMentions(root) {
        if (!root) return;
    
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
                            'script, style, textarea, input, button, a, .s7tv-emote, .s7tv-mention'
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
    
        const mentionRegex = /@[A-Za-zА-Яа-яЁё0-9_]+/gu;
    
        for (const node of nodes) {
            const text = node.nodeValue;
    
            if (!mentionRegex.test(text)) {
                mentionRegex.lastIndex = 0;
                continue;
            }
    
            mentionRegex.lastIndex = 0;
    
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let match;
    
            while ((match = mentionRegex.exec(text)) !== null) {
                if (match.index > lastIndex) {
                    fragment.appendChild(
                        document.createTextNode(
                            text.slice(lastIndex, match.index)
                        )
                    );
                }
    
                const mention = document.createElement('span');
                mention.className = 's7tv-mention';
                mention.textContent = match[0];
    
                fragment.appendChild(mention);
    
                lastIndex = mentionRegex.lastIndex;
            }
    
            if (lastIndex < text.length) {
                fragment.appendChild(
                    document.createTextNode(text.slice(lastIndex))
                );
            }
    
            node.replaceWith(fragment);
        }
    }

    function processChat(root = document.querySelector(CONFIG.chat)) {
        if (root) {
            highlightMentions(root);
            replaceEmotes(root);
        }
    }

    function refreshChatAppearance() {
        // Восстанавливаем CSS, если сайт удалил стили.
        addStyles();
    
        const chat = document.querySelector(CONFIG.chat);
        if (!chat) return;
    
        // Повторно проверяем сообщения.
        highlightMentions(chat);
        replaceEmotes(chat);
    }
    
    // Пользователь вернулся на вкладку.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            setTimeout(refreshChatAppearance, 150);
        }
    });
    
    // Пользователь вернулся в окно браузера.
    window.addEventListener('focus', () => {
        setTimeout(refreshChatAppearance, 150);
    });
    
    // Обрабатываем только добавленные узлы.
    function processAddedNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const message = node.parentElement?.closest('li.md');
    
            if (message) {
                highlightMentions(message);
                replaceEmotes(message);
            }
    
            return;
        }
    
        if (!(node instanceof Element)) return;
    
        if (node.matches('li.md')) {
            highlightMentions(node);
            replaceEmotes(node);
            return;
        }
    
        const parentMessage = node.closest('li.md');
    
        if (parentMessage) {
            highlightMentions(parentMessage);
            replaceEmotes(parentMessage);
            return;
        }
    
        const messages = node.querySelectorAll('li.md');
    
        if (messages.length) {
            messages.forEach(message => {
                highlightMentions(message);
                replaceEmotes(message);
            });
        } else {
            highlightMentions(node);
            replaceEmotes(node);
        }
    }
    // ==========================================
    // STYLES
    // ==========================================

    function addStyles() {
        if (document.getElementById('s7tv-styles')) return;
    
        const style = document.createElement('style');
        style.id = 's7tv-styles';

        style.textContent = ` 
        .s7tv-input-wrap {
            position: relative !important;
            flex: 1 1 auto !important;
            min-width: 0 !important;
            display: flex !important;
            align-items: center !important;
        }

        .s7tv-mention {
            color: #ffb4d2 !important;
            font-weight: 700 !important;
            text-shadow:
                0 0 3px rgba(255, 130, 185, 0.65),
                0 0 7px rgba(255, 105, 170, 0.45),
                0 0 12px rgba(255, 105, 170, 0.2) !important;
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
            overflow-x: hidden !important;
            box-sizing: border-box !important;
        
            display: flex;
            flex-direction: column;
            gap: 9px;
        }
        
        .s7tv-picker[hidden] {
            display: none !important;
        }

        .s7tv-tabs {
            display: flex !important;
            align-items: center !important;
            gap: 5px !important;
            width: 100% !important;
            min-width: 0 !important;
        }
        
        .s7tv-tab {
            appearance: none !important;
            -webkit-appearance: none !important;
        
            flex: 0 1 auto !important;
            min-width: 0 !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
        
            padding: 7px 9px !important;
            margin: 0 !important;
        
            background: #292b33 !important;
            border: 1px solid #41434c !important;
            border-radius: 6px !important;
        
            color: #aaa !important;
            font-size: 12px !important;
        
            box-shadow: none !important;
            cursor: pointer !important;
        }
        
        .s7tv-tab:first-child,
        .s7tv-tab:last-child {
            flex-shrink: 0 !important;
        }
        
        .s7tv-tab:nth-child(2) {
            flex: 1 1 auto !important;
        }
        
        .s7tv-tab:hover {
            background: #353741 !important;
            color: #fff !important;
        }
        
        .s7tv-tab.active {
            background: #493442 !important;
            border-color: #bd83a5 !important;
            color: #ffd9ec !important;
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
            display: grid !important;
            grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
            gap: 4px !important;
        
            overflow-y: auto !important;
            overflow-x: hidden !important;
        
            min-width: 0 !important;
            min-height: 0 !important;
            width: 100% !important;
        
            scrollbar-width: thin;
        }
        
        .s7tv-item {
            position: relative !important;
        
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        
            width: 100% !important;
            height: 36px !important;
            min-width: 0 !important;
            padding: 2px !important;
            margin: 0 !important;
        
            background: #292b33 !important;
            border: 1px solid rgba(255,255,255,.08) !important;
            border-radius: 6px !important;
        
            box-shadow: none !important;
            outline: none !important;
        }
        
        .s7tv-item:hover {
            background: #383b46 !important;
        }
        
        .s7tv-pick {
            appearance: none !important;
            -webkit-appearance: none !important;
        
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        
            width: 100% !important;
            height: 100% !important;
            min-width: 0 !important;
            padding: 2px !important;
            margin: 0 !important;
        
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
        }
        
        .s7tv-pick img {
            display: block !important;
            max-width: 30px !important;
            max-height: 28px !important;
            object-fit: contain !important;
        }
        
        .s7tv-favorite-toggle {
            position: absolute !important;
            top: 2px !important;
            right: 3px !important;
            z-index: 5 !important;
        
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        
            width: 15px !important;
            height: 15px !important;
            min-width: 0 !important;
            min-height: 0 !important;
        
            padding: 0 !important;
            margin: 0 !important;
        
            background: rgba(32, 33, 39, .8) !important;
            border: none !important;
            border-radius: 4px !important;
        
            color: #999 !important;
            font-size: 12px !important;
            line-height: 1 !important;
        
            box-shadow: none !important;
            cursor: pointer !important;
            opacity: .8;
        }
        
        .s7tv-favorite-toggle:hover {
            background: rgba(32, 33, 39, .95) !important;
            color: #ffd45c !important;
            opacity: 1;
        }
        
        .s7tv-favorite-toggle.active {
            color: #ffd45c !important;
            opacity: 1;
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
        
            height: 28px !important;
            width: auto !important;
        
            min-height: 28px !important;
            max-height: 28px !important;
        
            max-width: none !important;
        
            object-fit: contain !important;
            object-position: center !important;
        
            vertical-align: middle !important;
            flex-shrink: 0 !important;
        
            margin: 0 2px !important;
            box-sizing: border-box !important;
        }

        .s7tv-tab:first-child {
            flex: 0 0 38px !important;
            padding: 7px 5px !important;
            font-size: 16px !important;
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
    
        const tabs = document.createElement('div');
        tabs.className = 's7tv-tabs';
    
        const globalTab = document.createElement('button');
        globalTab.type = 'button';
        globalTab.className = 's7tv-tab active';
        globalTab.textContent = '🌐';
        globalTab.title = 'Global emotes';
    
        const channelTab = document.createElement('button');
        channelTab.type = 'button';
        channelTab.className = 's7tv-tab';
        channelTab.textContent = CONFIG.channel;
    
        const favoritesTab = document.createElement('button');
        favoritesTab.type = 'button';
        favoritesTab.className = 's7tv-tab';
        favoritesTab.textContent = '⭐';
    
        tabs.append(globalTab, channelTab, favoritesTab);
    
        const search = document.createElement('input');
        search.className = 's7tv-search';
        search.placeholder = 'Поиск смайлика...';
        search.type = 'text';
    
        const grid = document.createElement('div');
        grid.className = 's7tv-grid';
    
        panel.append(tabs, search, grid);
    
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
    
        let activeSet = 'global';
    
        const searchQueries = {
            global: '',
            channel: '',
            favorites: ''
        };
    
        function getActiveEmotes() {
            if (activeSet === 'global') return globalEmotes;
            if (activeSet === 'channel') return channelEmotes;
    
            const result = new Map();
    
            for (const name of favoriteEmotes) {
                const emote = emotes.get(name);
                if (emote) result.set(name, emote);
            }
    
            return result;
        }
    
        function saveFavorites() {
            localStorage.setItem(
                CONFIG.favoritesKey,
                JSON.stringify([...favoriteEmotes])
            );
        }
    
        function updateTabs() {
            globalTab.classList.toggle('active', activeSet === 'global');
            channelTab.classList.toggle('active', activeSet === 'channel');
            favoritesTab.classList.toggle('active', activeSet === 'favorites');
        }
    
        function insertEmote(name) {
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? start;
    
            const before = input.value.slice(0, start);
            const after = input.value.slice(end);
    
            const separator = before && !/\s$/.test(before) ? ' ' : '';
    
            input.value = before + separator + name + after;
    
            const cursor = (before + separator + name).length;
    
            input.focus();
            input.setSelectionRange(cursor, cursor);
    
            input.dispatchEvent(new Event('input', {
                bubbles: true
            }));
    
            panel.hidden = true;
        }
    
        function renderGrid() {
            grid.replaceChildren();
    
            const currentEmotes = getActiveEmotes();
            const query = searchQueries[activeSet].toLowerCase();
    
            const filtered = [...currentEmotes.keys()]
                .filter(name => name.toLowerCase().includes(query))
                .sort((a, b) => b.length - a.length)
                .slice(0, 150);
    
            if (!filtered.length) {
                const empty = document.createElement('div');
                empty.className = 's7tv-empty';
    
                empty.textContent = activeSet === 'favorites'
                    ? 'В избранном пока пусто'
                    : activeSet === 'channel'
                        ? 'В наборе канала пока нет смайликов'
                        : 'Смайлики не найдены';
    
                grid.appendChild(empty);
                return;
            }
    
            for (const name of filtered) {
                const emote = currentEmotes.get(name);
    
                const item = document.createElement('div');
                item.className = 's7tv-item';
                item.title = name;
    
                const pickButton = document.createElement('button');
                pickButton.type = 'button';
                pickButton.className = 's7tv-pick';
                pickButton.title = `Вставить ${name}`;
    
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
    
                pickButton.appendChild(img);
                pickButton.addEventListener('click', () => {
                    insertEmote(name);
                });
    
                const favoriteButton = document.createElement('button');
                favoriteButton.type = 'button';
                favoriteButton.className = 's7tv-favorite-toggle';
    
                function updateFavoriteButton() {
                    const isFavorite = favoriteEmotes.has(name);
    
                    favoriteButton.textContent = isFavorite ? '★' : '☆';
                    favoriteButton.classList.toggle('active', isFavorite);
                    favoriteButton.title = isFavorite
                        ? 'Убрать из избранного'
                        : 'Добавить в избранное';
                }
    
                updateFavoriteButton();
    
                favoriteButton.addEventListener('click', event => {
                    event.stopPropagation();
    
                    if (favoriteEmotes.has(name)) {
                        favoriteEmotes.delete(name);
                    } else {
                        favoriteEmotes.add(name);
                    }
    
                    saveFavorites();
    
                    if (activeSet === 'favorites') {
                        renderGrid();
                    } else {
                        updateFavoriteButton();
                    }
                });
    
                item.append(pickButton, favoriteButton);
                grid.appendChild(item);
            }
        }
    
        function switchTab(setName) {
            activeSet = setName;
            updateTabs();
    
            search.value = searchQueries[activeSet];
            renderGrid();
        }
    
        globalTab.addEventListener('click', () => {
            switchTab('global');
        });
    
        channelTab.addEventListener('click', () => {
            switchTab('channel');
        });
    
        favoritesTab.addEventListener('click', () => {
            switchTab('favorites');
        });
    
        button.addEventListener('click', () => {
            panel.hidden = !panel.hidden;
    
            if (!panel.hidden) {
                search.value = searchQueries[activeSet];
                renderGrid();
                search.focus();
            }
        });
    
        search.addEventListener('input', () => {
            searchQueries[activeSet] = search.value;
            renderGrid();
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
    
        const chats = Array.from(
            document.querySelectorAll(CONFIG.chat)
        );
    
        observedChats = chats;
    
        if (!chats.length) return;
    
        // Сбрасываем список только один раз.
        seenMessageIds.clear();
    
        // Обрабатываем все вкладки чата.
        for (const chat of chats) {
            processChat(chat);
            rememberExistingMessages(chat);
        }
    
        observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    checkAddedMessages(node);
                    processAddedNode(node);
                }
            }
        });
    
        // Следим за изменениями во всех чатах.
        for (const chat of chats) {
            observer.observe(chat, {
                childList: true,
                subtree: true
            });
        }
    }

    // ==========================================
    // MEOW NOTIFICATIONS
    // ==========================================

    // Разблокировка аудио после взаимодействия пользователя.
    function unlockMeowAudio() {
        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) {
            console.warn('[7TV] AudioContext не поддерживается');
            return;
        }

        if (!meowAudioContext) {
            meowAudioContext = new AudioContextClass();
        }

        if (meowAudioContext.state === 'suspended') {
            meowAudioContext.resume()
                .then(() => {
                    meowAudioUnlocked = true;
                    console.log('[7TV] Audio unlocked!');
                })
                .catch(error => {
                    console.warn('[7TV] Audio unlock failed:', error);
                });
        } else if (meowAudioContext.state === 'running') {
            meowAudioUnlocked = true;
        }
    }

    // Пользовательское взаимодействие разблокирует звук.
    document.addEventListener('pointerdown', unlockMeowAudio);
    document.addEventListener('keydown', unlockMeowAudio);

    // Воспроизведение звука упоминания.
    function playMeow() {
        console.log('[7TV] Попытка воспроизвести мяуканье');

        if (!meowAudioContext) {
            console.warn('[7TV] Сначала необходимо разблокировать аудио');
            return;
        }

        function playSound() {
            if (meowAudioContext.state !== 'running') {
                console.warn('[7TV] AudioContext не запущен');
                return;
            }

            const ctx = meowAudioContext;
            const now = ctx.currentTime;

            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();

            oscillator.type = 'sine';

            oscillator.frequency.setValueAtTime(650, now);
            oscillator.frequency.exponentialRampToValueAtTime(
                950, now + 0.12
            );
            oscillator.frequency.exponentialRampToValueAtTime(
                480, now + 0.38
            );

            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(0.22, now + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

            oscillator.connect(gain);
            gain.connect(ctx.destination);

            oscillator.start(now);
            oscillator.stop(now + 0.43);

            console.log('[7TV] Meow played!');
        }

        // Если браузер приостановил аудиоконтекст,
        // пробуем восстановить его.
        if (meowAudioContext.state === 'suspended') {
            meowAudioContext.resume()
                .then(playSound)
                .catch(error => {
                    console.warn('[7TV] Audio resume failed:', error);
                });

            return;
        }

        playSound();
    }

    function messageMentionsMe(message) {
        const nicknameElement = document.querySelector('.whn');
        const myNickname = nicknameElement?.textContent.trim();

        if (!myNickname) return false;

        const authorElement = message.querySelector('b[data-nick]');
        const author = authorElement?.dataset.nick;

        // Не уведомляем о собственных сообщениях.
        if (author?.toLowerCase() === myNickname.toLowerCase()) {
            return false;
        }

        const messageText = message.textContent || '';

        const escapedNickname = myNickname.replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&'
        );

        const mentionRegex = new RegExp(
            `(^|[^\\p{L}\\p{N}_])@?${escapedNickname}(?=$|[^\\p{L}\\p{N}_])`,
            'iu'
        );

        return mentionRegex.test(messageText);
    }

    function rememberExistingMessages(chat) {

        chat.querySelectorAll('li.md').forEach(message => {
            const id = message.dataset.mid;

            if (id) {
                seenMessageIds.add(id);
            }

            seenMessageElements.add(message);
        });
    }

    function checkNewMessage(message) {
        if (!(message instanceof Element)) return;
        if (!message.matches('li.md')) return;

        const id = message.dataset.mid;

        if (id && seenMessageIds.has(id)) return;
        if (seenMessageElements.has(message)) return;

        if (id) {
            seenMessageIds.add(id);

            // Ограничиваем размер списка обработанных сообщений.
            if (seenMessageIds.size > 500) {
                const oldest = seenMessageIds.values().next().value;
                seenMessageIds.delete(oldest);
            }
        }

        seenMessageElements.add(message);

        if (messageMentionsMe(message)) {
            playMeow();
            console.log('[7TV] 🐱 Тебя упомянули!');
        }
    }

    function checkAddedMessages(node) {
        let message = null;
    
        if (node instanceof Element) {
            if (node.matches('li.md')) {
                message = node;
            } else {
                message = node.closest('li.md');
    
                if (!message) {
                    message = node.querySelector('li.md');
                }
            }
        } else {
            message = node.parentElement?.closest('li.md');
        }
    
        if (!message) return;
    
        if (
            seenMessageElements.has(message) ||
            pendingMessages.has(message)
        ) {
            return;
        }
    
        pendingMessages.add(message);
    
        // Даём Legion время полностью заполнить сообщение.
        setTimeout(() => {
            pendingMessages.delete(message);
            checkNewMessage(message);
        }, 100);
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
        
            const chats = Array.from(
                document.querySelectorAll(CONFIG.chat)
            );
        
            if (!observer || !observerRootsAre(chats)) {
                startObserver();
            }
        }, 2000);
    }

    function observerRootsAre(chats) {
        if (!observer || chats.length !== observedChats.length) {
            return false;
        }
    
        return chats.every((chat, index) =>
            chat === observedChats[index] && chat.isConnected
        );
    }

    init();

})();
