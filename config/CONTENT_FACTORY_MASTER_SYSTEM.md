# CONTENT FACTORY — MASTER SYSTEM

This is the canonical generation policy for Content Factory. It must be used by the idea, script, storyboard, previs, image, video, audio, QC, retry and final assembly stages.

## 0. GLOBAL PRIORITY: PRODUCT DNA + LOCKED
The real product reference is the source of truth. The main product photo is canonical; extra photos only clarify angles, construction, details, packaging and colors.
Never invent or change shape, geometry, construction, proportions, material, color, details, mechanism, комплект, labels or real characteristics.
LOCKED product / avatar / location / wardrobe / props / continuity elements must remain unchanged unless the user explicitly requests that exact change.
When editing, change ONLY the requested element. Preserve everything else.
Accuracy is more important than beauty.

## 1. PIPELINE
PRODUCT DNA → ANALYSIS → REFERENCES → IDEAS → CREATIVE CRITIC → HOOK LAB → SCRIPT → RETENTION PASS → DIALOGUE/AUDIO PASS → SHOWRUNNER/REPAIR PASS → STORYBOARD → PREVIS → IMAGE DIRECTOR → VISUAL CONTINUITY → VISUAL QC → VIDEO PROMPT/PLAN → VIDEO GENERATION → TAKES/QC → VOICE/SFX/MUSIC/AMBIENCE → EDIT/REMOTION/FFMPEG → FINAL QC.
Do not silently skip stages.

## 2. PRODUCT DNA
Extract and persist: exact geometry, dimensions if actually supplied, materials, colors, surface, parts, mechanism, package contents, logo/markings, allowed interactions, forbidden mutations, canonical reference and supplemental references.
AI-generated frames are NOT new truth about the product. They are downstream assets. If they drift from the source, repair/regenerate them.

## 3. CHARACTER + LOCATION DNA
For recurring actors maintain Character Bible: full-body reference, portrait reference, face identity, body proportions, hair, wardrobe, voice and immutable identity traits.
For a location maintain Location DNA: layout, surfaces, furniture, light sources, palette, props and spatial relations.
Use consistent product reference + Character DNA + Location DNA across sequential shots.

## 4. IDEA ENGINE
Generate internally up to 20–30 mechanisms, not cosmetic rewrites. Surface 8–10 genuinely different mechanics when the UI needs options; select strongest concepts internally without copying competitors.
Evaluate: first 1–3 second hook, retention potential, clear product role, visual comprehension without sound, originality, production complexity/cost and feasibility as AI shots.
The script must develop the approved idea, not replace it with another concept.

## 5. CREATIVE CRITIC + HOOK LAB
Critic rejects generic, static, repetitive, physically impossible or product-distorting concepts.
Generate at least 5 distinct hooks. Hooks should be visual-first and understandable immediately. Where used by UI, create hook previs variants before committing expensive video generation.

## 6. SCRIPT
Required scene schema: scene number; exact time range; purpose; shot description; one primary action; actor action; product action/role; dialogue/VO; on-screen text; sound/SFX/ambience/music cue; camera/lens/movement; transition; continuity requirements; generation notes.
One frame = one clear primary action.
Add meaningful beats approximately every 1.5–3 seconds where appropriate.
Never invent product claims/specifications.
Dialogue timing must fit the shot duration naturally. No long text crammed into short clips.

## 7. RETENTION + AUDIO PASS
After script generation run a retention pass: remove dead air, repetitive beats and weak openings; strengthen visual progression without turning every shot into chaos.
Run dialogue/audio pass separately: natural Russian speech where applicable, realistic pauses and pacing, no robotic phrasing. Plan VO, lip-sync, ambience, SFX and music as separate layers.

## 8. STORYBOARD + PREVIS
Storyboard is derived strictly from the script.
For important scenes create START / MIDDLE / END visual states when useful for motion planning.
Target about 15–20 meaningful previs images for a 30-second commercial when the scenario benefits from it; longer cinematic content scales accordingly.
Do not repeatedly return to the raw product photo as the visual starting frame. Use the canonical product photo to enforce Product DNA; sequential shots should evolve from approved generated anchors/keyframes to preserve continuity.

## 9. IMAGE DIRECTOR PROMPT
Every image prompt should explicitly define: HERO SUBJECT + PRODUCT DNA + ACTION + CAMERA + COMPOSITION + LIGHT + LOCATION/WORLD + CROWD/EXTRAS if any + MATERIALS + CONTINUITY + NEGATIVE CONSTRAINTS.
Use hard constraint language where needed: EXACTLY / MUST / REMAIN / ONLY / NO.
No impossible hand/product intersections, duplicate parts, extra fingers, warped packaging, floating objects or unexplained geometry changes.
For identity-sensitive sequences, establish anchor/reference frames before generating dependent frames.

## 10. VISUAL CONTINUITY
Continuity is mandatory across adjacent shots: face, age appearance, body, hair, wardrobe, product geometry/color/details, room layout, prop positions, screen direction, time of day and lighting logic.
Generate sequentially from stable anchors when continuity risk is high. Avoid huge blind batches.

## 11. VISUAL QC + SELF-CORRECTION
QC happens BEFORE assets are shown or promoted downstream.
Check product fidelity, avatar identity, hands, anatomy, text, physics, spatial continuity, lighting continuity, framing and requested action.
If one frame is bad, regenerate/repair ONLY that frame or requested element. Do not destroy approved neighboring assets.
Retry should use diagnosed failure reason, not repeat the same prompt blindly.
Use fallback model/provider only when needed and record why.

## 12. VIDEO PROMPT / PLAN
Each shot gets a technical motion prompt based on approved keyframes: duration, start state, end state, subject movement, product movement, camera movement, speed, physics, facial performance, lip-sync requirement, environmental motion and forbidden mutations.
Image-to-video should use approved frames/anchors wherever possible.
Generate takes per shot only as needed; QC each shot before assembly.

## 13. CINEMATIC LONG FORM
For AI-film/series mode (roughly 1–5 min), plan approximately 40–70+ shots when pacing requires it. Maintain Character Bible, Location Bible and Product DNA through the whole sequence. Use storyboard → keyframes → video shots → audio layers → edit, rather than asking one model for an entire film in one generation.

## 14. AUDIO
Voice must not be silent, clipped or randomly missing. Validate audio duration and presence before final assembly.
Separate layers: dialogue/VO, lip-sync where needed, ambience, SFX, music. Mix so speech stays intelligible and music does not mask it.

## 15. EDIT + FINAL QC
Assemble with deterministic timeline tooling (Remotion/FFmpeg where enabled). Validate shot order, durations, transitions, audio sync, captions/safe zones, aspect ratio and missing media.
Final QC checks the entire video for product fidelity, continuity, visual artifacts, audio gaps, timing, duplicate/repeated frames and abrupt unrelated ending shots.
A failed final QC triggers targeted repair, not full regeneration.

## 16. AUTOMATION BEHAVIOR
Production target is fully automated: site → API → generation → QC → targeted retry/fallback → assembly.
Preserve progress and generated files on stop/resume. Do not delete completed media when a process is stopped.
Prevent duplicate paid generations and repeated billing for the same successful asset. Track provider/model/reason/cost/status for each generation.

## 17. COST POLICY
Use the cheapest model that can reliably perform the stage, but never save money by sacrificing Product DNA, identity, continuity or final QC. Expensive generation should happen only after cheap planning/previs/QC gates reduce avoidable retries.

## 18. NON-NEGOTIABLE NEGATIVES
NO invented specifications. NO product redesign. NO silent stage skipping. NO unrelated final frame. NO dead/silent voice track. NO giant blind batch when continuity matters. NO regeneration of approved assets unless they are the diagnosed problem. NO copying competitor creative shot-for-shot.
