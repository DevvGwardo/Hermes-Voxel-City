// Interactive 3D Voxel Character Builder Modal Controller.
// CSP-clean (styles served from public/styles.css), 0% GPU/CPU when closed, and zero helper-text clutter.

import * as THREE from "three";
import {
  AVATAR_LABELS,
  AVATAR_OPTIONS,
  buildCharacterAvatarRig,
  loadSavedAppearance,
  randomizeAppearance,
  sanitizeAppearance,
  saveAppearance,
} from "./voxel/character_system.js";

const BACK_MOUNTED_GEAR = new Set(["backpack", "cape", "wings", "guitar", "jetpack"]);

const CATEGORIES = [
  { id: "head", label: "Head" },
  { id: "hat", label: "Hat" },
  { id: "face", label: "Face" },
  { id: "outfit", label: "Outfit" },
  { id: "gear", label: "Gear" },
];

function createPedestalShadowTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0.0, "rgba(18, 32, 20, 0.34)");
  grad.addColorStop(0.55, "rgba(18, 32, 20, 0.14)");
  grad.addColorStop(1.0, "rgba(18, 32, 20, 0.0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCharacterBuilderController({
  dialogEl: providedDialogEl = null,
  onChange = null,
  onSave = null,
} = {}) {
  let dialogEl = providedDialogEl;
  if (!dialogEl && typeof document !== "undefined") {
    dialogEl = document.getElementById("avatar-dialog");
    if (!dialogEl) {
      dialogEl = document.createElement("dialog");
      dialogEl.id = "avatar-dialog";
      document.body.appendChild(dialogEl);
    }
  }

  dialogEl.classList.add("avatar-dialog");
  dialogEl.setAttribute("closedby", "any");

  let draft = loadSavedAppearance();
  let activeCategory = "head";

  // Build clean, self-explanatory DOM (zero helper text, zero subtitles)
  dialogEl.innerHTML = `
    <div class="cb-shell">
      <div class="cb-stage">
        <canvas class="cb-preview-canvas" aria-label="3D character preview"></canvas>
      </div>
      <div class="cb-panel">
        <div class="cb-top-row">
          <input
            type="text"
            id="cb-name-input"
            name="characterName"
            class="cb-name-input"
            placeholder="Name"
            maxlength="16"
            aria-label="Character name"
            autocomplete="off"
            spellcheck="false"
          />
          <button type="button" class="cb-close-btn" aria-label="Close">&times;</button>
        </div>
        <div class="cb-tabs" role="tablist" aria-label="Appearance categories"></div>
        <div class="cb-body"></div>
        <div class="cb-footer">
          <button type="button" class="cb-btn cb-btn-secondary" data-cb-action="randomize" aria-label="Randomize">
            <svg class="cb-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
              <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" />
              <circle cx="12" cy="12" r="1.2" fill="currentColor" />
              <circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" />
              <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
            </svg>
            <span>Randomize</span>
          </button>
          <button type="button" class="cb-btn cb-btn-secondary" data-cb-action="wave" aria-label="Wave">
            <span>Wave</span>
          </button>
          <button type="button" class="cb-btn cb-btn-primary" data-cb-action="save">
            <span>Save</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const stageEl = dialogEl.querySelector(".cb-stage");
  const canvasEl = dialogEl.querySelector(".cb-preview-canvas");
  const nameInputEl = dialogEl.querySelector(".cb-name-input");
  const closeBtnEl = dialogEl.querySelector(".cb-close-btn");
  const tabsEl = dialogEl.querySelector(".cb-tabs");
  const bodyEl = dialogEl.querySelector(".cb-body");
  const randomizeBtnEl = dialogEl.querySelector('[data-cb-action="randomize"]');
  const waveBtnEl = dialogEl.querySelector('[data-cb-action="wave"]');
  const saveBtnEl = dialogEl.querySelector('[data-cb-action="save"]');

  // Mandatory Safari light-dismiss backdrop click fallback
  const onBackdropClick = (e) => {
    if (e.target === dialogEl) {
      dialogEl.close();
    }
  };
  dialogEl.addEventListener("click", onBackdropClick);

  // Prevent typing W/A/S/D/Space/F in Name input from triggering world movement
  const stopWorldKeys = (e) => {
    if (e.key !== "Escape") {
      e.stopPropagation();
    }
  };
  dialogEl.addEventListener("keydown", stopWorldKeys);
  dialogEl.addEventListener("keyup", stopWorldKeys);

  // ---------------- Dedicated Mini 3D Preview Stage ----------------
  let renderer = null;
  let scene = null;
  let camera = null;
  let previewRig = null;
  let shadowTex = null;
  let pedestalGeo = null;
  let pedestalMat = null;
  let shadowGeo = null;
  let shadowMat = null;
  let resizeObserver = null;

  let rafId = 0;
  let lastFrameMs = 0;
  let elapsedSec = 0;
  let previewYaw = -0.2;
  let goalPreviewYaw = -0.2;
  let yawVelocity = 0;
  let isDragging = false;
  let dragPointerId = null;
  let dragStartX = 0;
  let dragMoved = 0;
  let waveTimer = 0;
  let hopY = 0;
  let hopVy = 0;
  let goalCamY = 1.22;
  let goalLookY = 1.16;
  let goalCamDist = 4.35;
  let curCamY = 1.22;
  let curLookY = 1.16;
  let curCamDist = 4.35;

  function triggerCheerReaction(kind = "hop") {
    if (kind === "wave") {
      waveTimer = 2.0;
      hopVy = Math.max(hopVy, 2.0);
      hopY = Math.max(hopY, 0.01);
    } else {
      hopVy = 2.4;
      hopY = Math.max(hopY, 0.01);
    }
  }

  function ensurePreviewStage() {
    if (scene || !canvasEl) return;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 30);

    const hemi = new THREE.HemisphereLight(0xf3f9ff, 0x86c864, 1.35);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff4de, 2.05);
    keyLight.position.set(3.4, 5.6, 4.4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xd9eeff, 0.65);
    fillLight.position.set(-3.6, 2.6, 2.8);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffe5bd, 0.55);
    rimLight.position.set(-1.8, 3.8, -4.2);
    scene.add(rimLight);

    // Subtle meadow pedestal disc + soft shadow disc
    pedestalGeo = new THREE.CylinderGeometry(0.76, 0.82, 0.09, 32);
    pedestalMat = new THREE.MeshStandardMaterial({
      color: "#89cb67",
      roughness: 0.85,
      metalness: 0.02,
    });
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.position.y = -0.046;
    scene.add(pedestal);

    shadowTex = createPedestalShadowTexture();
    shadowGeo = new THREE.PlaneGeometry(1.18, 1.18);
    shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
    shadowDisc.rotation.x = -Math.PI * 0.5;
    shadowDisc.position.y = 0.003;
    scene.add(shadowDisc);

    previewRig = buildCharacterAvatarRig(draft, {
      isLocalPlayer: false,
      scale: 0.145,
      castShadow: false,
    });
    scene.add(previewRig.root);

    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvasEl,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.04;
      renderer.setClearColor(0x000000, 0);
    } catch {
      renderer = null;
    }

    if (typeof ResizeObserver !== "undefined" && stageEl) {
      resizeObserver = new ResizeObserver(() => {
        if (dialogEl.open) syncCanvasSize();
      });
      resizeObserver.observe(stageEl);
    }
  }

  function syncCanvasSize() {
    if (!renderer || !camera || !stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const w = Math.max(120, Math.round(rect.width));
    const h = Math.max(120, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function updateCategoryFraming() {
    if (activeCategory === "face") {
      goalCamY = 1.36;
      goalLookY = 1.31;
      goalCamDist = 3.68;
      goalPreviewYaw = -0.14;
      return;
    }

    // Full head-to-toe + tall wizard/party hats + wings + pedestal framed cleanly
    goalCamY = 1.22;
    goalLookY = 1.16;
    goalCamDist = 4.35;

    if (activeCategory === "gear" && BACK_MOUNTED_GEAR.has(draft.accessory)) {
      goalPreviewYaw = 2.45;
    } else if (Math.abs(goalPreviewYaw) > 1.6 && activeCategory !== "gear") {
      goalPreviewYaw = -0.2;
    }
  }

  function renderPreviewFrame(nowMs) {
    rafId = 0;
    if (!dialogEl.open) return;

    const dt = lastFrameMs > 0 ? Math.min(0.05, Math.max(0.001, (nowMs - lastFrameMs) * 0.001)) : 0.016;
    lastFrameMs = nowMs;
    elapsedSec += dt;

    if (!isDragging) {
      if (Math.abs(yawVelocity) > 0.002) {
        goalPreviewYaw += yawVelocity * dt;
        yawVelocity *= Math.exp(-dt * 6.5);
      } else {
        yawVelocity = 0;
      }
      const diff = goalPreviewYaw - previewYaw;
      previewYaw += diff * (1 - Math.exp(-dt * 12));
    }

    if (waveTimer > 0) {
      waveTimer = Math.max(0, waveTimer - dt);
    }
    if (hopY > 0 || hopVy > 0) {
      hopY += hopVy * dt;
      hopVy -= 14.5 * dt;
      if (hopY <= 0) {
        hopY = 0;
        hopVy = 0;
      }
    }

    const camBlend = 1 - Math.exp(-dt * 9);
    curCamY += (goalCamY - curCamY) * camBlend;
    curLookY += (goalLookY - curLookY) * camBlend;
    curCamDist += (goalCamDist - curCamDist) * camBlend;

    if (previewRig) {
      previewRig.root.position.set(0, hopY, 0);
      // Pass Math.PI + previewYaw so previewYaw === 0 faces straight toward +Z preview camera
      const idleSway = isDragging ? 0 : Math.sin(elapsedSec * 1.15) * 0.06;
      previewRig.applyPose({
        dt,
        t: elapsedSec,
        yaw: Math.PI + previewYaw + idleSway,
        pitch: 0.05,
        speed: 0,
        anim: hopY > 0.03 ? "jump" : waveTimer > 0 ? "wave" : "idle",
        jumpY: hopY,
        waveTimer,
        isFirstPerson: false,
      });
    }

    if (renderer && scene && camera) {
      const aspectScale = Math.max(1, 0.54 / Math.max(0.4, camera.aspect || 1));
      camera.position.set(0, curCamY, curCamDist * aspectScale);
      camera.lookAt(0, curLookY, 0);
      renderer.render(scene, camera);
    }

    rafId = requestAnimationFrame(renderPreviewFrame);
  }

  function startPreviewLoop() {
    if (!dialogEl.open || rafId) return;
    ensurePreviewStage();
    syncCanvasSize();
    lastFrameMs = 0;
    rafId = requestAnimationFrame(renderPreviewFrame);
  }

  function stopPreviewLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    lastFrameMs = 0;
  }

  // Interactive turntable drag + tap-to-wave on preview stage
  stageEl.addEventListener("pointerdown", (e) => {
    isDragging = true;
    dragPointerId = e.pointerId;
    dragStartX = e.clientX;
    dragMoved = 0;
    yawVelocity = 0;
    try {
      stageEl.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors
    }
  });

  stageEl.addEventListener("pointermove", (e) => {
    if (!isDragging || e.pointerId !== dragPointerId) return;
    const dx = e.clientX - dragStartX;
    dragStartX = e.clientX;
    dragMoved += Math.abs(dx);
    const deltaYaw = dx * 0.013;
    previewYaw += deltaYaw;
    goalPreviewYaw = previewYaw;
    yawVelocity = deltaYaw * 24;
  });

  const endStageDrag = (e) => {
    if (!isDragging || (dragPointerId !== null && e.pointerId !== dragPointerId)) return;
    isDragging = false;
    dragPointerId = null;
    if (dragMoved < 5) {
      triggerCheerReaction("wave");
    }
  };
  stageEl.addEventListener("pointerup", endStageDrag);
  stageEl.addEventListener("pointercancel", endStageDrag);

  // ---------------- Controls Rendering ----------------

  function createChipRow(values, currentValue, onSelect) {
    const wrap = document.createElement("div");
    wrap.className = "cb-chips";
    for (const val of values) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cb-chip" + (val === currentValue ? " is-active" : "");
      btn.setAttribute("aria-pressed", val === currentValue ? "true" : "false");
      btn.textContent = AVATAR_LABELS[val] || val;
      btn.addEventListener("click", () => onSelect(val));
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function createSwatchRow(colors, currentHex, onSelect, { dimmed = false, leadingShoeIcon = false } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "cb-swatches" + (dimmed ? " is-dimmed" : "");

    if (leadingShoeIcon) {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("fill", "none");
      icon.setAttribute("stroke", "currentColor");
      icon.setAttribute("stroke-width", "1.9");
      icon.setAttribute("stroke-linecap", "round");
      icon.setAttribute("stroke-linejoin", "round");
      icon.setAttribute("aria-hidden", "true");
      icon.setAttribute("class", "cb-swatch-icon");
      icon.innerHTML = `<path d="M3 17h18v-2.5c0-1.6-1.3-2.9-2.9-3l-3.6-.3-3.2-4.2H8.5L7 12.2 3 13.5V17z"/><path d="M3 19.5h18"/>`;
      wrap.appendChild(icon);
    }

    const normCur = String(currentHex || "").toLowerCase();
    for (let i = 0; i < colors.length; i++) {
      const hex = colors[i];
      const isAct = hex.toLowerCase() === normCur;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cb-swatch" + (isAct ? " is-active" : "");
      btn.style.backgroundColor = hex;
      btn.setAttribute("aria-label", `Color ${i + 1}`);
      btn.setAttribute("aria-pressed", isAct ? "true" : "false");
      btn.addEventListener("click", () => onSelect(hex));
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function applyDraftUpdate(patch, reaction = "hop") {
    draft = sanitizeAppearance({ ...draft, ...patch });
    if (nameInputEl.value !== draft.name && document.activeElement !== nameInputEl) {
      nameInputEl.value = draft.name;
    }
    if (previewRig) {
      previewRig.setAppearance(draft);
    }
    updateCategoryFraming();
    if (reaction) {
      triggerCheerReaction(reaction);
    }
    renderControls();
    onChange?.({ ...draft });
  }

  function renderTabs() {
    tabsEl.innerHTML = "";
    for (const cat of CATEGORIES) {
      const isAct = cat.id === activeCategory;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.role = "tab";
      btn.className = "cb-tab-btn" + (isAct ? " is-active" : "");
      btn.setAttribute("aria-selected", isAct ? "true" : "false");
      btn.textContent = cat.label;
      btn.addEventListener("click", () => {
        activeCategory = cat.id;
        updateCategoryFraming();
        renderTabs();
        renderControls();
      });
      tabsEl.appendChild(btn);
    }
  }

  function renderControls() {
    bodyEl.innerHTML = "";

    if (activeCategory === "head") {
      const skinCard = document.createElement("div");
      skinCard.className = "cb-group-card";
      skinCard.appendChild(
        createSwatchRow(AVATAR_OPTIONS.skinColors, draft.skin, (skin) =>
          applyDraftUpdate({ skin }, "hop"),
        ),
      );
      bodyEl.appendChild(skinCard);

      const hairCard = document.createElement("div");
      hairCard.className = "cb-group-card";
      hairCard.appendChild(
        createChipRow(AVATAR_OPTIONS.hairStyles, draft.hairStyle, (hairStyle) =>
          applyDraftUpdate({ hairStyle }, "hop"),
        ),
      );
      hairCard.appendChild(
        createSwatchRow(
          AVATAR_OPTIONS.hairColors,
          draft.hairColor,
          (hairColor) => applyDraftUpdate({ hairColor }, null),
          { dimmed: draft.hairStyle === "none" },
        ),
      );
      bodyEl.appendChild(hairCard);
    } else if (activeCategory === "hat") {
      const hatCard = document.createElement("div");
      hatCard.className = "cb-group-card";
      hatCard.appendChild(
        createChipRow(AVATAR_OPTIONS.hatStyles, draft.hatStyle, (hatStyle) =>
          applyDraftUpdate({ hatStyle }, "hop"),
        ),
      );
      hatCard.appendChild(
        createSwatchRow(
          AVATAR_OPTIONS.hatColors,
          draft.hatColor,
          (hatColor) => applyDraftUpdate({ hatColor }, null),
          { dimmed: draft.hatStyle === "none" || draft.hatStyle === "sprout" },
        ),
      );
      bodyEl.appendChild(hatCard);
    } else if (activeCategory === "face") {
      const faceCard = document.createElement("div");
      faceCard.className = "cb-group-card";
      faceCard.appendChild(
        createChipRow(AVATAR_OPTIONS.eyeStyles, draft.eyeStyle, (eyeStyle) =>
          applyDraftUpdate({ eyeStyle }, "hop"),
        ),
      );
      bodyEl.appendChild(faceCard);
    } else if (activeCategory === "outfit") {
      const topCard = document.createElement("div");
      topCard.className = "cb-group-card";
      topCard.appendChild(
        createChipRow(AVATAR_OPTIONS.topStyles, draft.topStyle, (topStyle) =>
          applyDraftUpdate({ topStyle }, "hop"),
        ),
      );
      topCard.appendChild(
        createSwatchRow(AVATAR_OPTIONS.topColors, draft.topColor, (topColor) =>
          applyDraftUpdate({ topColor }, null),
        ),
      );
      bodyEl.appendChild(topCard);

      const bottomCard = document.createElement("div");
      bottomCard.className = "cb-group-card";
      bottomCard.appendChild(
        createChipRow(AVATAR_OPTIONS.bottomStyles, draft.bottomStyle, (bottomStyle) =>
          applyDraftUpdate({ bottomStyle }, "hop"),
        ),
      );
      bottomCard.appendChild(
        createSwatchRow(AVATAR_OPTIONS.bottomColors, draft.bottomColor, (bottomColor) =>
          applyDraftUpdate({ bottomColor }, null),
        ),
      );
      bodyEl.appendChild(bottomCard);

      const shoeCard = document.createElement("div");
      shoeCard.className = "cb-group-card";
      shoeCard.appendChild(
        createSwatchRow(
          AVATAR_OPTIONS.shoeColors,
          draft.shoeColor,
          (shoeColor) => applyDraftUpdate({ shoeColor }, null),
          { leadingShoeIcon: true },
        ),
      );
      bodyEl.appendChild(shoeCard);
    } else if (activeCategory === "gear") {
      const gearCard = document.createElement("div");
      gearCard.className = "cb-group-card";
      gearCard.appendChild(
        createChipRow(AVATAR_OPTIONS.accessories, draft.accessory, (accessory) => {
          if (BACK_MOUNTED_GEAR.has(accessory)) {
            goalPreviewYaw = 2.45;
          } else {
            goalPreviewYaw = -0.2;
          }
          applyDraftUpdate({ accessory }, "hop");
        }),
      );
      gearCard.appendChild(
        createSwatchRow(
          AVATAR_OPTIONS.accessoryColors,
          draft.accessoryColor,
          (accessoryColor) => applyDraftUpdate({ accessoryColor }, null),
          { dimmed: draft.accessory === "none" },
        ),
      );
      bodyEl.appendChild(gearCard);
    }
  }

  // ---------------- Input & Footer Listeners ----------------

  nameInputEl.addEventListener("input", () => {
    draft = sanitizeAppearance({ ...draft, name: nameInputEl.value });
    onChange?.({ ...draft });
  });

  nameInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitSave();
    }
  });

  closeBtnEl.addEventListener("click", () => {
    close();
  });

  randomizeBtnEl.addEventListener("click", () => {
    const next = randomizeAppearance(true, nameInputEl.value);
    draft = next;
    if (previewRig) previewRig.setAppearance(draft);
    goalPreviewYaw = -0.32;
    triggerCheerReaction("wave");
    renderControls();
    onChange?.({ ...draft });
  });

  waveBtnEl.addEventListener("click", () => {
    goalPreviewYaw = -0.25;
    triggerCheerReaction("wave");
  });

  function commitSave() {
    draft = sanitizeAppearance({ ...draft, name: nameInputEl.value });
    const saved = saveAppearance(draft);
    onSave?.({ ...saved });
    close();
  }

  saveBtnEl.addEventListener("click", commitSave);

  dialogEl.addEventListener("close", () => {
    stopPreviewLoop();
  });

  // ---------------- Public Controller API ----------------

  function open(initialAppearance = null) {
    if (initialAppearance && typeof initialAppearance === "object") {
      draft = sanitizeAppearance(initialAppearance);
    } else {
      draft = loadSavedAppearance();
    }
    nameInputEl.value = draft.name;
    previewYaw = -0.32;
    goalPreviewYaw = -0.32;
    yawVelocity = 0;

    ensurePreviewStage();
    if (previewRig) {
      previewRig.setAppearance(draft);
    }
    updateCategoryFraming();
    renderTabs();
    renderControls();

    if (!dialogEl.open) {
      if (typeof dialogEl.showModal === "function") {
        dialogEl.showModal();
      } else {
        dialogEl.setAttribute("open", "");
      }
    }

    triggerCheerReaction("wave");
    startPreviewLoop();
  }

  function close() {
    stopPreviewLoop();
    if (dialogEl.open) {
      if (typeof dialogEl.close === "function") {
        dialogEl.close();
      } else {
        dialogEl.removeAttribute("open");
      }
    }
  }

  function isOpen() {
    return Boolean(dialogEl.open);
  }

  function getAppearance() {
    return { ...draft };
  }

  function setAppearance(app) {
    draft = sanitizeAppearance(app);
    nameInputEl.value = draft.name;
    if (previewRig) {
      previewRig.setAppearance(draft);
    }
    if (dialogEl.open) {
      renderControls();
    }
    return { ...draft };
  }

  function dispose() {
    stopPreviewLoop();
    dialogEl.removeEventListener("click", onBackdropClick);
    dialogEl.removeEventListener("keydown", stopWorldKeys);
    dialogEl.removeEventListener("keyup", stopWorldKeys);
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (previewRig) {
      previewRig.dispose();
      previewRig = null;
    }
    pedestalGeo?.dispose();
    pedestalMat?.dispose();
    shadowGeo?.dispose();
    shadowMat?.dispose();
    shadowTex?.dispose();
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
    scene = null;
    camera = null;
  }

  renderTabs();
  renderControls();

  return {
    dialogEl,
    open,
    close,
    isOpen,
    getAppearance,
    setAppearance,
    dispose,
  };
}
