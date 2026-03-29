(() => {
    // 1. 获取 DOM 元素
    const line1 = document.getElementById("lyric-line-1");
    const line2 = document.getElementById("lyric-line-2");
    const subLine = document.getElementById("lyric-sub");
    const bgVideo = document.querySelector(".bg-video");
    const referenceVideo = document.getElementById("reference-video");

    if (!line1) return;

    // 用于精确计算字符宽度的 Canvas
    const measureCanvas = document.createElement("canvas");
    const measureContext = measureCanvas.getContext("2d");

    // 2. 配置时间轴 (根据 The-Title-Design.md)
    const totalDurationMs = 21000;
    const sceneTimeline = [
        {
            startMs: 0,
            endMs: 6900,
            text: "longer way ah",
            subText: "长",
            lineY: "25vh",
            interpolation: "linear",
            keyframes: [
                { t: 0, p: 0 },
                { t: 2000, p: 100 }
            ]
        },
        {
            startMs: 7000,
            endMs: 12900,
            text: "ed to be a story",
            subText: "者",
            lineY: "40vh",
            interpolation: "linear",
            keyframes: [
                { t: 0, p: 0 },
                { t: 1500, charIndex: 3 },  // "ed "
                { t: 2500, charIndex: 6 },  // "to "
                { t: 3500, charIndex: 11 }, // "be a "
                { t: 5000, p: 100 }         // "story"
            ]
        },
        {
            startMs: 13000,
            endMs: 20000,
            text: "ys painted the",
            text2: "in",
            lineY: "35vh",
            line2Y: "60vh",
            interpolation: "bezier",
            keyframes: [
                { t: 0, p: 0 },
                { t: 1000, charIndex: 3 },
                { t: 3500, charIndex: 11 },
                { t: 5000, p: 100 }
            ],
            keyframes2: [
                { t: 5100, p: 0 },
                { t: 5500, charIndex: 0 },
                { t: 6500, p: 100 }
            ]
        },
        {
            startMs: 20100,
            endMs: 21000,
            text: "o eventually g",
            lineY: "40vh",
            interpolation: "linear",
            keyframes: [{ t: 0, p: 0 }] // 视频结束前尚未开始涂色
        }
    ];

    const easingFns = {
        linear: (v) => v,
        bezier: (v) => {
            const t = Math.max(0, Math.min(1, v));
            const inv = 1 - t;
            // 模拟 Apple Music 的平滑贝塞尔曲线
            return (3 * inv * inv * t * 0.12) + (3 * inv * t * t * 0.92) + (t * t * t);
        }
    };

    let activeSceneIndex = -1;
    let elapsedMs = 0;
    let lastTick = performance.now();

    // 3. 核心逻辑函数
    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    // 解析关键帧中的字符位置为百分比
    function resolveLineKeyframes(scene, textProp, kfProp, lineEl) {
        const text = scene[textProp];
        const kfs = scene[kfProp];
        if (!text || !kfs) return;

        // 临时设置样式以测量
        const style = window.getComputedStyle(lineEl);
        measureContext.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const fullWidth = Math.max(1, measureContext.measureText(text).width);

        scene[kfProp + "_resolved"] = kfs.map(kf => {
            let p = typeof kf.p === "number" ? kf.p : 0;
            if (typeof kf.charIndex === "number") {
                const before = text.slice(0, kf.charIndex);
                const char = text[kf.charIndex] || "";
                const beforeW = measureContext.measureText(before).width;
                const charW = measureContext.measureText(char).width;
                p = ((beforeW + (charW * 0.5)) / fullWidth) * 100;
            }
            return { t: kf.t, p: clamp(p, 0, 100), ease: kf.ease || scene.interpolation || "linear" };
        });
    }

    function resolveAllKeyframes() {
        sceneTimeline.forEach(s => {
            resolveLineKeyframes(s, "text", "keyframes", line1);
            if (s.text2) resolveLineKeyframes(s, "text2", "keyframes2", line2);
        });
    }

    function sampleKeyframes(keyframes, timeMs) {
        if (!keyframes || keyframes.length === 0) return 0;
        if (timeMs <= keyframes[0].t) return keyframes[0].p;
        if (timeMs >= keyframes[keyframes.length - 1].t) return keyframes[keyframes.length - 1].p;

        for (let i = 0; i < keyframes.length - 1; i++) {
            const curr = keyframes[i];
            const next = keyframes[i+1];
            if (timeMs <= next.t) {
                const ratio = (timeMs - curr.t) / (next.t - curr.t);
                const eased = (easingFns[curr.ease] || easingFns.linear)(ratio);
                return curr.p + (next.p - curr.p) * eased;
            }
        }
        return 0;
    }

    function applyScene(scene) {
        // 先移除可见类，触发退出效果
        line1.classList.remove("visible");
        line2.classList.remove("visible");
        
        // 强制重绘 (Reflow) 以确保动画能重新触发
        void line1.offsetWidth; 

        // 更新内容
        line1.textContent = scene.text;
        line1.dataset.text = scene.text;
        line1.style.setProperty("--line-y", scene.lineY);

        if (scene.text2) {
            line2.textContent = scene.text2;
            line2.dataset.text = scene.text2;
            line2.style.setProperty("--line-y", scene.line2Y);
            line2.classList.add("visible");
        }

        // 重新添加可见类，触发丝滑的入场动画
        line1.classList.add("visible");

        if (subLine) {
            subLine.style.opacity = "0";
            setTimeout(() => {
                subLine.textContent = scene.subText || "";
                subLine.style.opacity = scene.subText ? "1" : "0";
            }, 200);
        }
    }

    function render(timeMs) {
        const norm = ((timeMs % totalDurationMs) + totalDurationMs) % totalDurationMs;
        let idx = 0;
        for (let i = sceneTimeline.length - 1; i >= 0; i--) {
            if (norm >= sceneTimeline[i].startMs) { idx = i; break; }
        }

        const scene = sceneTimeline[idx];
        if (idx !== activeSceneIndex) {
            activeSceneIndex = idx;
            applyScene(scene);
        }

        const localTime = norm - scene.startMs;
        
        // 更新第一行
        const wipe1 = sampleKeyframes(scene.keyframes_resolved, localTime);
        line1.style.setProperty("--wipe", `${wipe1}%`);

        // 更新第二行
        if (scene.text2) {
            const wipe2 = sampleKeyframes(scene.keyframes2_resolved, localTime);
            line2.style.setProperty("--wipe", `${wipe2}%`);
        }
    }

    // 4. 同步与循环
    function tick(now) {
        const v = (referenceVideo && referenceVideo.readyState >= 1) ? referenceVideo : bgVideo;
        if (v && v.readyState >= 1) {
            elapsedMs = (v.currentTime / v.duration) * totalDurationMs;
            // 确保背景视频同步
            if (referenceVideo && bgVideo && Math.abs(bgVideo.currentTime - referenceVideo.currentTime) > 0.1) {
                bgVideo.currentTime = referenceVideo.currentTime;
            }
        } else {
            elapsedMs = (elapsedMs + (now - lastTick)) % totalDurationMs;
        }
        
        lastTick = now;
        render(elapsedMs);
        requestAnimationFrame(tick);
    }

    // 5. 初始化启动
    window.addEventListener("resize", () => {
        resolveAllKeyframes();
        activeSceneIndex = -1; // 强制重绘
    });

    // 确保视频播放
    [bgVideo, referenceVideo].forEach(v => {
        if (v) v.play().catch(() => {});
    });

    resolveAllKeyframes();
    requestAnimationFrame(tick);
})();