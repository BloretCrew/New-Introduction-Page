(() => {
    const protoLine1 = document.getElementById("lyric-line-1");
    const protoLine2 = document.getElementById("lyric-line-2");
    const bgVideo = document.querySelector(".bg-video");
    const referenceVideo = document.getElementById("reference-video");
    const scrollTrack = document.getElementById("scroll-track");
    const panels = Array.from(document.querySelectorAll(".panel"));
    const navTargets = Array.from(document.querySelectorAll("[data-target]"));
    const scrollNext = document.getElementById("scroll-next");

    if (!protoLine1 || !scrollTrack || panels.length === 0) return;

    if (protoLine1) {
        protoLine1.style.opacity = "0";
        protoLine1.style.pointerEvents = "none";
    }
    if (protoLine2) {
        protoLine2.style.opacity = "0";
        protoLine2.style.pointerEvents = "none";
    }

    let activeSceneGroup = null;
    let activeSceneIndex = -1;
    let elapsedMs = 0;
    let lastTick = performance.now();
    let charCache = new Map();
    let activePanelIndex = 0;
    let isTransitioning = false;
    let wheelLockUntil = 0;
    let touchStartY = null;
    let accumulatedDelta = 0;

    const measureCanvas = document.createElement("canvas");
    const measureContext = measureCanvas.getContext("2d");

    let sceneTimeline = [
        {
            startMs: 0,
            endMs: 6900,
            text: "Loading...",
            subText: "",
            lineY: "45vh",
            interpolation: "linear",
            keyframes: [{ t: 0, p: 0 }, { t: 2000, p: 100 }]
        }
    ];

    const easingFns = {
        linear: (v) => v,
        bezier: (v) => {
            const t = Math.max(0, Math.min(1, v));
            const inv = 1 - t;
            return (3 * inv * inv * t * 0.12) + (3 * inv * t * t * 0.92) + (t * t * t);
        }
    };

    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    function updatePanelState(index) {
        activePanelIndex = clamp(index, 0, panels.length - 1);
        scrollTrack.style.transform = `translate3d(0, -${activePanelIndex * 100}vh, 0)`;

        panels.forEach((panel, i) => {
            panel.classList.toggle("active", i === activePanelIndex);
        });

        navTargets.forEach((item) => {
            const target = Number(item.dataset.target);
            const isActive = target === activePanelIndex;
            item.classList.toggle("active", isActive);
            if (item.classList.contains("panel-dot")) {
                item.setAttribute("aria-current", isActive ? "true" : "false");
            }
        });
    }

    function goToPanel(index) {
        const nextIndex = clamp(index, 0, panels.length - 1);
        if (nextIndex === activePanelIndex || isTransitioning) return;

        isTransitioning = true;
        wheelLockUntil = Date.now() + 1280;
        updatePanelState(nextIndex);

        window.setTimeout(() => {
            isTransitioning = false;
        }, 1220);
    }

    function movePanel(direction) {
        goToPanel(activePanelIndex + direction);
    }

    function handleWheel(event) {
        event.preventDefault();
        if (Date.now() < wheelLockUntil) return;

        accumulatedDelta += event.deltaY;
        if (Math.abs(accumulatedDelta) < 36) return;

        const direction = accumulatedDelta > 0 ? 1 : -1;
        accumulatedDelta = 0;
        movePanel(direction);
    }

    function handleTouchStart(event) {
        touchStartY = event.touches[0]?.clientY ?? null;
    }

    function handleTouchEnd(event) {
        if (touchStartY === null || Date.now() < wheelLockUntil) return;
        const endY = event.changedTouches[0]?.clientY;
        if (typeof endY !== "number") return;

        const deltaY = touchStartY - endY;
        touchStartY = null;
        if (Math.abs(deltaY) < 50) return;

        movePanel(deltaY > 0 ? 1 : -1);
    }

    function handleKeydown(event) {
        if (["ArrowDown", "PageDown", "Space"].includes(event.key)) {
            event.preventDefault();
            movePanel(1);
        }
        if (["ArrowUp", "PageUp"].includes(event.key)) {
            event.preventDefault();
            movePanel(-1);
        }
        if (event.key === "Home") {
            event.preventDefault();
            goToPanel(0);
        }
        if (event.key === "End") {
            event.preventDefault();
            goToPanel(panels.length - 1);
        }
    }

    function bindNavigation() {
        navTargets.forEach((item) => {
            item.addEventListener("click", (event) => {
                event.preventDefault();
                const target = Number(item.dataset.target);
                if (!Number.isNaN(target)) goToPanel(target);
            });
        });

        if (scrollNext) {
            scrollNext.addEventListener("click", () => movePanel(1));
        }

        window.addEventListener("wheel", handleWheel, { passive: false });
        window.addEventListener("touchstart", handleTouchStart, { passive: true });
        window.addEventListener("touchend", handleTouchEnd, { passive: true });
        window.addEventListener("keydown", handleKeydown);
        window.addEventListener("resize", () => updatePanelState(activePanelIndex));
    }

    function resolveLineKeyframes(scene, textProp, kfProp, lineEl) {
        const text = scene[textProp];
        const kfs = scene[kfProp];
        if (!text || !kfs) return;

        lineEl.textContent = text;
        const style = window.getComputedStyle(lineEl);
        measureContext.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const fullWidth = Math.max(1, measureContext.measureText(text).width);

        scene[`${kfProp}_resolved`] = kfs.map((kf) => {
            let p = typeof kf.p === "number" ? kf.p : 0;
            if (typeof kf.charIndex === "number") {
                const before = text.slice(0, kf.charIndex);
                p = (measureContext.measureText(before).width / fullWidth) * 100;
            }
            return { t: kf.t, p: clamp(p, 0, 100), ease: kf.ease || scene.interpolation || "linear" };
        });
    }

    function resolveAllKeyframes() {
        sceneTimeline.forEach((scene) => {
            resolveLineKeyframes(scene, "text", "keyframes", protoLine1);
            if (scene.text2) resolveLineKeyframes(scene, "text2", "keyframes2", protoLine2);
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
        el.innerHTML = "";
        const spans = [];
        text.split("").forEach((char) => {
            const span = document.createElement("span");
            const content = char === " " ? "\u00A0" : char;
            span.textContent = content;
            span.className = "lyric-char";
            span.setAttribute("data-char", content);
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
        const stage = document.getElementById("lyric-stage");
        const oldScenes = stage.querySelectorAll(".lyric-scene:not(.exiting)");
        oldScenes.forEach((s) => {
            s.classList.remove("visible");
            s.classList.add("exiting");
            setTimeout(() => s.remove(), 1000);
        });

        charCache.clear();
        activeSceneGroup = document.createElement("div");
        activeSceneGroup.className = "lyric-scene";
        stage.appendChild(activeSceneGroup);

        createNewLine(activeSceneGroup, scene.text, scene.lineY);
        if (scene.text2) createNewLine(activeSceneGroup, scene.text2, scene.line2Y);

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

        const totalChars = chars.length;
        const currentActiveIndex = (wipePercent / 100) * totalChars;

        for (let i = 0; i < chars.length; i++) {
            const progress = clamp(currentActiveIndex - i, 0, 1);
            chars[i].style.setProperty("--char-progress", progress.toFixed(3));
        }
    }

    function render(timeMs) {
        const actualTotalDuration = sceneTimeline.length * 7000;
        const norm = ((timeMs % actualTotalDuration) + actualTotalDuration) % actualTotalDuration;
        let idx = 0;
        for (let i = sceneTimeline.length - 1; i >= 0; i--) {
            if (norm >= sceneTimeline[i].startMs) {
                idx = i;
                break;
            }
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
        const v = referenceVideo && referenceVideo.readyState >= 1 ? referenceVideo : bgVideo;
        const actualTotalDuration = sceneTimeline.length * 7000;
        if (v && v.readyState >= 1 && Number.isFinite(v.duration) && v.duration > 0) {
            elapsedMs = (v.currentTime / v.duration) * actualTotalDuration;
        } else {
            elapsedMs = (elapsedMs + (now - lastTick)) % actualTotalDuration;
        }
        lastTick = now;
        render(elapsedMs);
        requestAnimationFrame(tick);
    }

    async function loadConfig() {
        try {
            const response = await fetch("config.json");
            const config = await response.json();

            if (config.titles && config.titles.length > 0) {
                const newTimeline = [];
                const sceneDuration = 7000;

                config.titles.forEach((item, i) => {
                    newTimeline.push({
                        startMs: i * sceneDuration,
                        endMs: (i + 1) * sceneDuration - 100,
                        text: item.main,
                        subText: item.sub || "",
                        lineY: "45vh",
                        interpolation: "linear",
                        keyframes: [{ t: 0, p: 0 }, { t: 4000, p: 100 }]
                    });
                });

                sceneTimeline = newTimeline;
            }
        } catch (error) {
            console.error("Config failed:", error);
        } finally {
            resolveAllKeyframes();
            activeSceneGroup = null;
            updatePanelState(0);
            bindNavigation();
        }
    }

    loadConfig();
    requestAnimationFrame(tick);
})();
