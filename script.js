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
            const response = await fetch('config.json');
            const config = await response.json();
            
            if (config.titles && config.titles.length > 0) {
                // 根据 config.json 动态生成时间轴
                const newTimeline = [];
                const sceneDuration = 7000; // 每个场景 7 秒
                
                config.titles.forEach((t, i) => {
                    newTimeline.push({
                        startMs: i * sceneDuration,
                        endMs: (i + 1) * sceneDuration - 100,
                        text: t.main,
                        subText: t.sub || "",
                        lineY: "45vh",
                        interpolation: "linear",
                        // 给予充裕的时间来完成“擦除”动画
                        keyframes: [{ t: 0, p: 0 }, { t: 4000, p: 100 }]
                    });
                });
                
                sceneTimeline = newTimeline;
                // 注意：这里需要根据总场景数更新全局时长，否则无法循环
                // 但为了保持逻辑兼容性，我们暂时就在 tick 中动态计算
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
            const content = char === ' ' ? '\u00A0' : char;
            span.textContent = content;
            span.className = 'lyric-char';
            span.setAttribute('data-char', content);
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
            const subY = scene.text2 ? "68vh" : "55vh";
            const subLine = document.createElement("p");
            subLine.className = "lyric-line lyric-sub-inline";
            subLine.style.setProperty("--line-y", subY);
            subLine.textContent = scene.subText;
            activeSceneGroup.appendChild(subLine);
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