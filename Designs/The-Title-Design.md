为了让 AI 渲染引擎（如基于 After Effects 表达式的脚本、Canvas API 或 WebGL 着色器）能够完美复刻该动画，以下文档采用了高精度、结构化的伪代码与技术参数描述。

该文档定义了全局环境、着色器/材质行为以及基于毫秒级时间轴的关键帧数据。

---

### [ANIMATION_RENDER_BLUEPRINT_V1.0]

#### 1. GLOBAL_ENVIRONMENT
```json
{
  "resolution": "dynamic_crop",
  "aspect_ratio": "1:1 (approximate reference based on provided frame)",
  "background": {
    "type": "solid_color",
    "color_hex": "#70687D",
    "color_rgba": [112, 104, 125, 255],
    "noise_overlay": "none",
    "motion": "static"
  },
  "typography": {
    "primary_font": {
        "family": "San Francisco Pro Display / Helvetica Neue",
        "weight": 800,
        "style": "condensed_bold",
        "letter_spacing": "-0.02em"
    },
    "secondary_font": {
        "family": "PingFang SC / System Chinese Font",
        "weight": 700
    }
  },
  "layout_rules": {
    "text_alignment": "left",
    "x_origin": "off_screen_left", 
    "description": "The left side of the text is heavily cropped. The visible text implies continuous strings starting from outside the left boundary."
  }
}
```

#### 2. SHADER_AND_MATERIAL_DEFINITIONS (The "Apple Music" Effect)
```glsl
// CONCEPTUAL SHADER FOR TEXT REVEAL
Material "LyricText" {
  BaseColor: RGBA(255, 255, 255, 1.0);
  InactiveOpacity: 0.35; // The dim state of un-sung lyrics
  ActiveOpacity: 1.00;   // The bright state of sung lyrics

  // The wipe mask is a soft linear gradient moving along the X-axis
  Mask "KaraokeWipe" {
    Type: LinearGradient_Horizontal;
    EdgeFeather: 15px; // Soft blur at the leading edge of the wipe
    LeadingGlow: {
      intensity: 1.2,
      radius: 5px,
      color: RGBA(255,255,255, 1.0)
    };
    
    // Function to calculate opacity per pixel based on mask X position
    float calcOpacity(pixel_X, mask_X, edge_width) {
       if (pixel_X < mask_X - edge_width) return ActiveOpacity;
       if (pixel_X > mask_X) return InactiveOpacity;
       // Smoothstep interpolation for the glowing feathered edge
       return lerp(ActiveOpacity, InactiveOpacity, smoothstep(mask_X - edge_width, mask_X, pixel_X));
    }
  }
}
```

#### 3. TIMELINE_SEQUENCE_DATA
时间轴以秒（Seconds）为单位，包含文本内容的绝对替换（Hard Cuts）和遮罩的 X 轴移动关键帧。

**SCENE_01 [00:00.000 - 00:06.900]**
```yaml
Scene: 1
Transition_In: Hard_Cut
Elements:
  - id: text_main_1
    string: "longer way ah"
    font: primary_font
    position: {y: "20vh", x_start: "visible_crop_0"} 
    state: static
    material_override: { current_opacity: 1.0 } // Fully highlighted from start
  - id: text_sub_1
    string: "长" // Partially visible at bottom left
    font: secondary_font
    position: {y: "70vh", x_start: "visible_crop_0"}
    state: static
    material_override: { current_opacity: 1.0 }
Animation_Events: [] // No active wipe in this segment
```

**SCENE_02 [00:07.000 - 00:12.900]**
```yaml
Scene: 2
Transition_In: Hard_Cut (Instantly replaces Scene_01)
Elements:
  - id: text_main_2
    string: "ed to be a story"
    font: primary_font
    position: {y: "40vh", x_start: "visible_crop_0"}
  - id: text_sub_2
    string: "者" // Partially visible at bottom left
    font: secondary_font
    position: {y: "75vh", x_start: "visible_crop_0"}
Animation_Events:
  - target: text_main_2_Mask.mask_X
    type: linear_interpolation
    keyframes:
      - time: 00:07.000, value: text_start_X // All text is at InactiveOpacity (0.35)
      - time: 00:08.500, value: get_X_coord(char 't' in "to")
      - time: 00:09.500, value: get_X_coord(char 'b' in "be")
      - time: 00:10.500, value: get_X_coord(char 's' in "story")
      - time: 00:12.000, value: text_end_X // Wipe finishes, text fully ActiveOpacity (1.0)
```

**SCENE_03 [00:13.000 - 00:19.900]**
```yaml
Scene: 3
Transition_In: Hard_Cut
Elements:
  - id: text_main_3_line1
    string: "ys painted the"
    font: primary_font
    position: {y: "35vh", x_start: "visible_crop_0"}
  - id: text_main_3_line2
    string: "in"
    font: primary_font
    position: {y: "65vh", x_start: "visible_crop_0"}
Animation_Events:
  - target: text_main_3_line1_Mask.mask_X
    type: bezier_interpolation
    keyframes:
      - time: 00:13.000, value: text_start_X // Both lines InactiveOpacity
      - time: 00:14.000, value: get_X_coord(char 'p' in "painted")
      - time: 00:16.500, value: get_X_coord(char 't' in "the")
      - time: 00:18.000, value: text_end_X // Line 1 fully active
  - target: text_main_3_line2_Mask.mask_X
    type: linear_interpolation
    keyframes:
      - time: 00:18.100, value: text_start_X // Wipe jumps to Line 2 immediately after Line 1 finishes
      - time: 00:18.500, value: get_X_coord(char 'i' in "in")
      - time: 00:19.500, value: text_end_X // Line 2 fully active
```

**SCENE_04 [00:20.000 - 00:21.000] (End of Source)**
```yaml
Scene: 4
Transition_In: Hard_Cut
Elements:
  - id: text_main_4
    string: "o eventually g"
    font: primary_font
    position: {y: "40vh", x_start: "visible_crop_0"}
    state: static
    material_override: { current_opacity: 0.35 } // Text spawned but not yet highlighted
Animation_Events: [] // Video ends before the wipe triggers on this line
```

#### 4. ENGINE RENDERING INSTRUCTIONS
1.  **Canvas Setup:** Initialize a solid colored plane using `GLOBAL_ENVIRONMENT.background.color_rgba`.
2.  **Typography Rendering:** Render text using thick, sans-serif fonts. The text origin must be placed outside the negative X boundary of the camera frame to simulate the cropped effect seen in the source material.
3.  **Alpha Compositing:** Apply the `LyricText` material. Default state for all newly spawned text is `InactiveOpacity (0.35)`.
4.  **Execution:** Parse `TIMELINE_SEQUENCE_DATA`. At each `Hard_Cut`, instantly clear the previous text buffers and instantiate the new strings.
5.  **Mask Automation:** Drive the `mask_X` property using the defined keyframes. The X coordinate must map to the bounding box of the specified characters. Apply the `EdgeFeather` to ensure the transition from `1.0` to `0.35` opacity is a smooth pixel gradient (about 15-20 pixels wide), not a harsh aliased line.