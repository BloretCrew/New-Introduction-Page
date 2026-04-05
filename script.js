(() => {
    const protoLine1 = document.getElementById("lyric-line-1");
    const protoLine2 = document.getElementById("lyric-line-2");
    const subLine = document.getElementById("lyric-sub");
    const bgVideo = document.querySelector(".bg-video");
    const referenceVideo = document.getElementById("reference-video");

    if (!protoLine1) return;

    // Hide prototype lines so they don't show up in the animation,
    // but keep them in DOM for getComputedStyle
    if (protoLine1) { protoLine1.style.opacity = '0'; protoLine1.style.pointerEvents = 'none'; }
    if (protoLine2) { protoLine2.style.opacity = '0'; protoLine2.style.pointerEvents = 'none'; }

    let activeSceneGroup = null;

    const measureCanvas = document.createElement("canvas");
    const measureContext = measureCanvas.getContext("2d");

    const totalDurationMs = 21000;
    let sceneTimeline = [
        {
            startMs: 0, endMs: 6900,
            text: "Loading...", subText: "",
            lineY: "45vh", interpolation: "linear",
            keyframes: [{ t: 0, p: 0 }, { t: 2000, p: 100 }]
        }
    ];

    async function loadConfig() {
        try {
            const response = await fetch('custom.yaml');
            const yamlText = await response.text();
            const config = jsyaml.load(yamlText);
            
            // 兼容新旧配置结构
            const titles = config.hero?.titles || config.titles || [];
            
            if (titles.length > 0) {
                // 根据 custom.yaml 动态生成时间轴
                const newTimeline = [];
                const sceneDuration = 7000; // 每个场景 7 秒
                
                titles.forEach((t, i) => {
                    newTimeline.push({
                        startMs: i * sceneDuration,
                        endMs: (i + 1) * sceneDuration - 100,
                        text: t.main,
                        subText: t.sub || "",
                        lineY: "45vh",
                        interpolation: "linear",
                        keyframes: [{ t: 0, p: 0 }, { t: 4000, p: 100 }]
                    });
                });
                
                sceneTimeline = newTimeline;
            }
        } catch (e) {
            console.error("Config failed:", e);
        } finally {
            resolveAllKeyframes();
            activeSceneGroup = null;
        }
    }

    const easingFns = {
        linear: (v) => v,
        bezier: (v) => {
            const t = Math.max(0, Math.min(1, v));
            const inv = 1 - t;
            return (3 * inv * inv * t * 0.12) + (3 * inv * t * t * 0.92) + (t * t * t);
        }
    };

    let activeSceneIndex = -1;
    let elapsedMs = 0;
    let lastTick = performance.now();
    let charCache = new Map();

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function resolveLineKeyframes(scene, textProp, kfProp, lineEl) {
        const text = scene[textProp];
        const kfs = scene[kfProp];
        if (!text || !kfs) return;

        lineEl.textContent = text; // 暂时设置内容用于测量
        const style = window.getComputedStyle(lineEl);
        measureContext.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const fullWidth = Math.max(1, measureContext.measureText(text).width);

        scene[kfProp + "_resolved"] = kfs.map(kf => {
            let p = typeof kf.p === "number" ? kf.p : 0;
            if (typeof kf.charIndex === "number") {
                const before = text.slice(0, kf.charIndex);
                p = (measureContext.measureText(before).width / fullWidth) * 100;
            }
            return { t: kf.t, p: clamp(p, 0, 100), ease: kf.ease || scene.interpolation || "linear" };
        });
    }

    function resolveAllKeyframes() {
        sceneTimeline.forEach(s => {
            resolveLineKeyframes(s, "text", "keyframes", protoLine1);
            if (s.text2) resolveLineKeyframes(s, "text2", "keyframes2", protoLine2);
        });
    }

    function sampleKeyframes(keyframes, timeMs) {
        if (!keyframes || keyframes.length === 0) return 0;
        if (timeMs <= keyframes[0].t) return keyframes[0].p;
        if (timeMs >= keyframes[keyframes.length - 1].t) return keyframes[keyframes.length - 1].p;
        for (let i = 0; i < keyframes.length - 1; i++) {
            const curr = keyframes[i];
            const next = keyframes[i + 1];
            if (timeMs <= next.t) {
                const ratio = (timeMs - curr.t) / (next.t - curr.t);
                return curr.p + (next.p - curr.p) * (easingFns[curr.ease] || easingFns.linear)(ratio);
            }
        }
        return 0;
    }

    function splitToSpans(el, text) {
        el.innerHTML = '';
        const spans = [];
        text.split('').forEach(char => {
            const span = document.createElement('span');
            // 空格使用普通空格（允许换行），非空格字符保持原样
            const isSpace = char === ' ';
            const content = isSpace ? ' ' : char;
            span.textContent = content;
            span.className = 'lyric-char' + (isSpace ? ' lyric-space' : '');
            span.setAttribute('data-char', isSpace ? '\u00A0' : content);
            el.appendChild(span);
            spans.push(span);
        });

        requestAnimationFrame(() => {
            charCache.set(el, spans);
        });
    }

    function createNewLine(container, text, lineY) {
        const newLine = document.createElement("p");
        newLine.className = "lyric-line lyric-line-main";
        newLine.style.setProperty("--line-y", lineY);
        container.appendChild(newLine);
        splitToSpans(newLine, text);
        return newLine;
    }

    function applyScene(scene) {
        // Find existing scene groups and transition them out
        const stage = document.getElementById("lyric-stage");
        const oldScenes = stage.querySelectorAll(".lyric-scene:not(.exiting)");
        oldScenes.forEach(s => {
            s.classList.remove("visible");
            s.classList.add("exiting");
            setTimeout(() => s.remove(), 1000);
        });

        charCache.clear();

        // Create new scene group wrapper
        activeSceneGroup = document.createElement("div");
        activeSceneGroup.className = "lyric-scene";
        stage.appendChild(activeSceneGroup);

        // Add lines to the SAME group
        const line1 = createNewLine(activeSceneGroup, scene.text, scene.lineY);
        const line2 = scene.text2 ? createNewLine(activeSceneGroup, scene.text2, scene.line2Y) : null;

        // 副标题也加入组，并根据主行数动态调整高度（主标题下方 12vh 处）
        if (scene.subText) {
            const subLine = document.createElement("p");
            subLine.className = "lyric-line lyric-sub-inline";
            subLine.textContent = scene.subText;
            activeSceneGroup.appendChild(subLine);

            // 使用 requestAnimationFrame 确保 DOM 渲染后获取实际高度
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const line1Rect = line1.getBoundingClientRect();
                    const line2Rect = line2 ? line2.getBoundingClientRect() : null;
                    const stageRect = activeSceneGroup.getBoundingClientRect();

                    // 计算最后一行相对于 stage 的底部位置
                    const lastLineBottom = line2Rect
                        ? line2Rect.bottom - stageRect.top
                        : line1Rect.bottom - stageRect.top;

                    // 副标题位置：最后一行底部 + 12vh 间距
                    const spacing = window.innerHeight * (-0.05);
                    const subY = lastLineBottom + spacing;
                    subLine.style.setProperty("--line-y", `${subY}px`);
                });
            });
        }

        requestAnimationFrame(() => {
            activeSceneGroup.classList.add("visible");
        });
    }

    function updateCharPhysics(el, wipePercent) {
        const chars = charCache.get(el);
        if (!chars) return;
        
        // 改为基于索引（Index-based）而不是基于位置（Geometric）的物理进度
        // 这样可以完美支持自动换行，且保持从左到右、逐行高亮的逻辑一致性
        const totalChars = chars.length;
        const currentActiveIndex = (wipePercent / 100) * totalChars;

        for (let i = 0; i < chars.length; i++) {
            // progress: 前面的字是 1，正在过度的字是 0~1，后面的字是 0
            const progress = clamp(currentActiveIndex - i, 0, 1);
            chars[i].style.setProperty('--char-progress', progress.toFixed(3));
        }
    }

    function render(timeMs) {
        const actualTotalDuration = sceneTimeline.length * 7000;
        const norm = ((timeMs % actualTotalDuration) + actualTotalDuration) % actualTotalDuration;
        let idx = 0;
        for (let i = sceneTimeline.length - 1; i >= 0; i--) {
            if (norm >= sceneTimeline[i].startMs) { idx = i; break; }
        }

        const scene = sceneTimeline[idx];
        if (!scene) return;

        if (idx !== activeSceneIndex) {
            activeSceneIndex = idx;
            applyScene(scene);
        }

        const localTime = norm - scene.startMs;
        const wipe1 = sampleKeyframes(scene.keyframes_resolved, localTime);
        const lines = activeSceneGroup ? activeSceneGroup.querySelectorAll(".lyric-line") : [];
        if (lines[0]) updateCharPhysics(lines[0], wipe1);

        if (scene.text2) {
            const wipe2 = sampleKeyframes(scene.keyframes2_resolved, localTime);
            if (lines[1]) updateCharPhysics(lines[1], wipe2);
        }
    }

    function tick(now) {
        const v = (referenceVideo && referenceVideo.readyState >= 1) ? referenceVideo : bgVideo;
        const actualTotalDuration = sceneTimeline.length * 7000;
        if (v && v.readyState >= 1) {
            elapsedMs = (v.currentTime / v.duration) * actualTotalDuration;
        } else {
            elapsedMs = (elapsedMs + (now - lastTick)) % actualTotalDuration;
        }
        lastTick = now;
        render(elapsedMs);
        requestAnimationFrame(tick);
    }

    loadConfig();
    requestAnimationFrame(tick);
})();

// ========== 分页控制系统 ==========
((global) => {
    // 分页状态
    let currentPage = 0;
    let isAnimating = false;
    let isScrollLocked = false;
    const totalPages = 4;
    const scrollThreshold = 50; // 滚动阈值
    let touchStartY = 0;
    let scrollAccumulator = 0;

    // DOM 元素
    const pagesContainer = document.getElementById('pages-container');
    const pages = document.querySelectorAll('.page');
    const paginationDots = document.querySelectorAll('.pagination-dot');

    // 初始化
    function init() {
        if (!pagesContainer) return;

        // 绑定导航点击事件
        paginationDots.forEach(dot => {
            dot.addEventListener('click', (e) => {
                const targetPage = parseInt(e.target.dataset.page);
                if (targetPage !== currentPage && !isAnimating) {
                    goToPage(targetPage);
                }
            });
        });

        // 绑定滚轮事件
        global.addEventListener('wheel', handleWheel, { passive: false });

        // 绑定触摸事件（移动端）
        global.addEventListener('touchstart', handleTouchStart, { passive: true });
        global.addEventListener('touchend', handleTouchEnd, { passive: true });

        // 绑定键盘事件
        global.addEventListener('keydown', handleKeydown);

        // 绑定导航链接点击
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const href = link.getAttribute('href');
                if (href === '#hero') goToPage(0);
                else if (href === '#features') goToPage(1);
                else if (href === '#pricing') goToPage(2);
                else if (href === '#about') goToPage(3);
            });
        });

        // 初始化第一页
        updateActiveStates();
    }

    // 处理滚轮事件
    function handleWheel(e) {
        if (isAnimating) {
            e.preventDefault();
            return;
        }

        const delta = e.deltaY;
        scrollAccumulator += delta;

        if (Math.abs(scrollAccumulator) > scrollThreshold) {
            if (scrollAccumulator > 0 && currentPage < totalPages - 1) {
                goToPage(currentPage + 1);
            } else if (scrollAccumulator < 0 && currentPage > 0) {
                goToPage(currentPage - 1);
            }
            scrollAccumulator = 0;
            e.preventDefault();
        }
    }

    // 处理触摸开始
    function handleTouchStart(e) {
        touchStartY = e.touches[0].clientY;
    }

    // 处理触摸结束
    function handleTouchEnd(e) {
        if (isAnimating) return;

        const touchEndY = e.changedTouches[0].clientY;
        const diff = touchStartY - touchEndY;

        if (Math.abs(diff) > 50) {
            if (diff > 0 && currentPage < totalPages - 1) {
                goToPage(currentPage + 1);
            } else if (diff < 0 && currentPage > 0) {
                goToPage(currentPage - 1);
            }
        }
    }

    // 处理键盘事件
    function handleKeydown(e) {
        if (isAnimating) return;

        switch (e.key) {
            case 'ArrowDown':
            case 'PageDown':
                if (currentPage < totalPages - 1) {
                    e.preventDefault();
                    goToPage(currentPage + 1);
                }
                break;
            case 'ArrowUp':
            case 'PageUp':
                if (currentPage > 0) {
                    e.preventDefault();
                    goToPage(currentPage - 1);
                }
                break;
            case 'Home':
                e.preventDefault();
                goToPage(0);
                break;
            case 'End':
                e.preventDefault();
                goToPage(totalPages - 1);
                break;
        }
    }

    // 切换到指定页面
    function goToPage(targetPage) {
        if (isAnimating || targetPage === currentPage) return;
        if (targetPage < 0 || targetPage >= totalPages) return;

        isAnimating = true;

        // 移除当前页面激活状态
        pages[currentPage].classList.remove('active');

        // 添加目标页面激活状态
        currentPage = targetPage;
        pages[currentPage].classList.add('active');

        // 更新导航指示器
        updateActiveStates();

        // 动画完成后解锁
        setTimeout(() => {
            isAnimating = false;
        }, 700); // 与 CSS transition 时间一致
    }

    // 更新激活状态
    function updateActiveStates() {
        paginationDots.forEach((dot, index) => {
            if (index === currentPage) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window);

// ========== 配置渲染系统 ==========
((global) => {
    let appConfig = null;

    // 加载并应用配置
    async function loadAndApplyConfig() {
        try {
            const response = await fetch('custom.yaml');
            const yamlText = await response.text();
            appConfig = jsyaml.load(yamlText);

            // 渲染各个部分
            renderNavbar();
            renderHero();
            renderCore();
            renderServices();
            renderAbout();
            renderMeta();

            console.log('✅ 配置加载成功 (custom.yaml)');
        } catch (e) {
            console.error('❌ 配置加载失败:', e);
        }
    }

    // 渲染导航栏
    function renderNavbar() {
        const { navbar } = appConfig;
        if (!navbar) return;

        // 品牌名称
        const brandEl = document.querySelector('.navbar-title');
        if (brandEl && navbar.brand) {
            brandEl.textContent = navbar.brand;
        }

        // 导航链接
        const navContainer = document.querySelector('.navbar-nav');
        if (navContainer && navbar.links) {
            navContainer.innerHTML = '';
            
            navbar.links.forEach(link => {
                const a = document.createElement('a');
                a.className = 'nav-link';
                a.href = link.href;
                a.textContent = link.label;
                a.dataset.page = link.page;
                navContainer.appendChild(a);
            });

            // CTA 按钮
            if (navbar.ctaButton) {
                const cta = document.createElement('a');
                cta.className = 'nav-link passport';
                cta.href = navbar.ctaButton.href;
                cta.textContent = navbar.ctaButton.label;
                navContainer.appendChild(cta);
            }
        }
    }

    // 渲染 Hero 区域（滚动提示文字）
    function renderHero() {
        const { hero } = appConfig;
        if (!hero) return;

        // 滚动提示
        const scrollHintText = document.querySelector('.scroll-hint-text');
        if (scrollHintText && hero.scrollHint) {
            scrollHintText.textContent = hero.scrollHint;
        }
    }

    // 渲染 About 区域
    function renderAbout() {
        const { about } = appConfig;
        if (!about) return;

        // 标题
        const titleEl = document.querySelector('.page-4 .page-title');
        if (titleEl) titleEl.textContent = about.title;

        const subtitleEl = document.querySelector('.page-4 .page-subtitle');
        if (subtitleEl) subtitleEl.textContent = about.subtitle;

        // 内容文字
        const textEl = document.querySelector('.about-text');
        if (textEl && about.content) {
            textEl.innerHTML = about.content.join('<br>');
        }

        // CTA 按钮
        const ctaSection = document.querySelector('.cta-section');
        if (ctaSection && about.ctaButtons) {
            ctaSection.innerHTML = '';
            
            about.ctaButtons.forEach(btn => {
                const button = document.createElement('button');
                button.className = `cta-button ${btn.type}`;
                button.textContent = btn.label;
                if (btn.href && btn.href !== '#') {
                    button.onclick = () => window.open(btn.href, '_blank');
                }
                ctaSection.appendChild(button);
            });
        }

        // 数据统计
        const statsGrid = document.querySelector('.stats-grid');
        if (statsGrid && about.stats) {
            statsGrid.innerHTML = '';
            
            about.stats.forEach(stat => {
                const item = document.createElement('div');
                item.className = 'stat-item';
                item.innerHTML = `
                    <span class="stat-value">${stat.value}</span>
                    <span class="stat-label">${stat.label}</span>
                `;
                statsGrid.appendChild(item);
            });
        }
    }

    // 渲染核心服务区域（Minecraft 服务器）
    function renderCore() {
        const { core } = appConfig;
        if (!core) return;

        // 标题
        const titleEl = document.querySelector('.page-2 .page-title');
        if (titleEl) titleEl.textContent = core.title;

        const subtitleEl = document.querySelector('.page-2 .page-subtitle');
        if (subtitleEl) subtitleEl.textContent = core.subtitle;

        // 服务器信息
        if (core.server) {
            const ipEl = document.getElementById('server-ip');
            if (ipEl) ipEl.textContent = core.server.ip;

            const descEl = document.querySelector('.server-description');
            if (descEl) descEl.textContent = core.server.description;

            // Launcher 推荐信息
            if (core.server.launcher) {
                const launcherBtn = document.querySelector('.launcher-btn');
                if (launcherBtn) {
                    launcherBtn.href = core.server.launcher.url || '#';
                }

                const launcherText = document.querySelector('.launcher-text');
                if (launcherText && core.server.launcher.name) {
                    launcherText.textContent = `推荐使用 ${core.server.launcher.name} 加入`;
                }

                const launcherHint = document.querySelector('.launcher-hint');
                if (launcherHint) {
                    launcherHint.textContent = core.server.launcher.hint || '';
                }
            }
        }

        // 服务器特色
        const gridEl = document.querySelector('.page-2 .features-grid');
        if (gridEl && core.server?.features) {
            gridEl.innerHTML = '';
            
            core.server.features.forEach(item => {
                const card = document.createElement('div');
                card.className = 'feature-card';
                card.innerHTML = `
                    <div class="feature-icon">${item.icon}</div>
                    <h3 class="feature-title">${item.title}</h3>
                    <p class="feature-desc">${item.description}</p>
                `;
                gridEl.appendChild(card);
            });
        }
    }

    // 渲染更多服务区域
    function renderServices() {
        const { services } = appConfig;
        if (!services) return;

        // 标题
        const titleEl = document.querySelector('.page-3 .page-title');
        if (titleEl) titleEl.textContent = services.title;

        const subtitleEl = document.querySelector('.page-3 .page-subtitle');
        if (subtitleEl) subtitleEl.textContent = services.subtitle;

        // 服务卡片
        const gridEl = document.querySelector('.services-grid');
        if (gridEl && services.items) {
            gridEl.innerHTML = '';
            
            services.items.forEach(item => {
                const card = document.createElement('a');
                card.className = 'service-card';
                card.href = item.url;
                card.target = '_blank';
                card.style.setProperty('--service-color', item.color);
                card.innerHTML = `
                    <span class="service-icon">${item.icon}</span>
                    <div class="service-info">
                        <h3 class="service-name">${item.name}</h3>
                        <p class="service-desc">${item.description}</p>
                    </div>
                `;
                gridEl.appendChild(card);
            });
        }
    }

    // 渲染 Meta 信息
    function renderMeta() {
        const { site } = appConfig;
        if (!site) return;

        // 页面标题
        if (site.title) {
            document.title = site.title;
        }

        // Favicon
        if (site.favicon) {
            let link = document.querySelector("link[rel*='icon']");
            if (!link) {
                link = document.createElement('link');
                link.rel = 'icon';
                document.head.appendChild(link);
            }
            link.href = site.favicon;
        }
    }

    // 暴露配置给其他模块
    global.getAppConfig = () => appConfig;

    // 页面加载时执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadAndApplyConfig);
    } else {
        loadAndApplyConfig();
    }
})(window);

// ========== 工具函数 ==========
// 复制服务器 IP
function copyIP() {
    const ip = document.getElementById('server-ip').textContent;
    navigator.clipboard.writeText(ip).then(() => {
        const btn = document.querySelector('.copy-btn');
        const originalText = btn.textContent;
        btn.textContent = '已复制!';
        btn.style.background = 'rgba(76, 175, 80, 0.3)';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 2000);
    }).catch(err => {
        console.error('复制失败:', err);
    });
}