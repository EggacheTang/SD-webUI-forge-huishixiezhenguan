  const STORAGE_INDEX_KEY = "sd_visual_library_output_pool_index_v6_no_global_negative";
  const STORAGE_ITEM_PREFIX = "sd_visual_library_output_pool_item_v6_no_global_negative_";
  const STORAGE_LAST_KEY = "sd_visual_library_output_pool_last_v6_no_global_negative";
  const STORAGE_APPEARANCE_KEY = "visual_random_prompt_workshop_appearance_v1";
  const STORAGE_HISTORY_KEY = "visual_random_prompt_workshop_generation_history_v1";
  const STORAGE_ONBOARDING_KEY = "visual_random_prompt_workshop_onboarding_v1";
  const HISTORY_LIMIT = 80;
  const MAX_FORGE_SEED = 4294967295;
  const FORGE_DIMENSION_STEP = 32;
  const LIBRARY_CARD_PAGE_SIZE = 40;
  const CATEGORY_BATCH_CARD_RENDER_BATCH_SIZE = 72;

  let appearanceSettings = loadAppearanceSettings();

  function createId(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function loadAppearanceSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_APPEARANCE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};

      return {
        launchBackground: typeof parsed.launchBackground === "string" ? parsed.launchBackground : "",
        appBackground: typeof parsed.appBackground === "string" ? parsed.appBackground : ""
      };
    } catch {
      return {
        launchBackground: "",
        appBackground: ""
      };
    }
  }

  function saveAppearanceSettings() {
    localStorage.setItem(STORAGE_APPEARANCE_KEY, JSON.stringify(appearanceSettings));
  }

  function cssBackgroundValue(src) {
    return src ? `url("${String(src).replace(/"/g, '\\"')}")` : "none";
  }

  function applyBackgroundImages() {
    document.documentElement.style.setProperty(
      "--launch-background-image",
      cssBackgroundValue(appearanceSettings.launchBackground)
    );
    document.documentElement.style.setProperty(
      "--app-background-image",
      cssBackgroundValue(appearanceSettings.appBackground)
    );
  }

  async function chooseBackgroundImage(target) {
    if (!window.localApp?.choosePreviewImage) {
      alert("当前环境无法打开图片选择器。");
      return;
    }

    try {
      const result = await window.localApp.choosePreviewImage();
      if (!result || result.canceled || !result.path) return;

      if (target === "launch") {
        appearanceSettings.launchBackground = result.path;
      } else {
        appearanceSettings.appBackground = result.path;
      }

      saveAppearanceSettings();
      applyBackgroundImages();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  }

  function clearBackgroundImage(target) {
    if (target === "launch") {
      appearanceSettings.launchBackground = "";
    } else {
      appearanceSettings.appBackground = "";
    }

    saveAppearanceSettings();
    applyBackgroundImages();
  }

  applyBackgroundImages();

  function loadGenerationHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveGenerationHistory() {
    localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(generationHistory.slice(0, HISTORY_LIMIT)));
  }

  function summarizeText(text, maxLength = 72) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }

  function getCardSnapshot(card, target) {
    const category = getCategoryById(card.categoryId);
    const categoryGroup = category ? getCategoryGroupById(category.groupId) : null;

    return {
      id: card.id,
      categoryId: card.categoryId || "",
      categoryName: category?.name || "",
      categoryGroupName: categoryGroup?.name || "",
      zh: card.zh || "",
      prompt: card.prompt || "",
      image: card.image || "",
      strength: getCardStrength(card),
      tags: typeof card.tags === "string" ? card.tags : "",
      target
    };
  }

  function cardHasADetailerPromptTag(card, kind) {
    const tagName = kind === "hand" ? "\u624b" : kind === "face" ? "\u8138" : "";
    if (!tagName) return false;

    return cardHasTag(card, tagName);
  }

  function getADetailerPromptKindForCard(card) {
    const category = getCategoryById(card?.categoryId);
    if (!category) return "";

    const group = getCategoryGroupById(category.groupId);
    const groupText = `${group?.id || ""} ${group?.name || ""}`.toLowerCase();
    const categoryText = `${category.id || ""} ${category.name || ""}`.toLowerCase();
    const isPersonGroup = /人物|character|body|attrs/.test(groupText);
    const isStateGroup = /姿态|状态|action|pose/.test(groupText);
    const isAllowedGroup = isPersonGroup || isStateGroup;

    if (!isAllowedGroup) return "";

    if (/手|上肢|手臂|胳膊|腕|指|hand|arm|wrist|finger/.test(categoryText)) {
      return "hand";
    }

    if (/脸|面|表情|头|眉|眼|瞳|嘴|口|唇|齿|耳|发色|发型|化妆|皮肤|face|head|expression|eye|pupil|mouth|lip|ear|hair|makeup|skin|brow/.test(categoryText)) {
      return "face";
    }

    return "";
  }

  function buildADetailerPromptText(selectedCards, kind) {
    const parts = (Array.isArray(selectedCards) ? selectedCards : [])
      .filter(card => cardHasADetailerPromptTag(card, kind))
      .map(formatCardPrompt)
      .filter(Boolean);

    return removeDuplicateParts(parts).join(", ");
  }

  function buildADetailerPrompts(selectedCards) {
    return {
      face: buildADetailerPromptText(selectedCards, "face"),
      hand: buildADetailerPromptText(selectedCards, "hand")
    };
  }

  const examplePositiveCardId = createId("card");
  const exampleNegativeCardId = createId("card");
  const defaultCardIds = {
    softLight: createId("card"),
    cinematic: createId("card"),
    soloGirl: createId("card"),
    casualOutfit: createId("card"),
    kimono: createId("card"),
    standingPose: createId("card"),
    lookingBack: createId("card"),
    smile: createId("card"),
    closeUp: createId("card"),
    fullBody: createId("card"),
    cityNight: createId("card"),
    garden: createId("card"),
    negativeHands: createId("card"),
    negativeQuality: createId("card")
  };

  let categoryGroups = [
    { id: "scene", name: "画面" },
    { id: "characterAttrs", name: "人物" },
    { id: "clothing", name: "服饰" },
    { id: "characterActions", name: "姿态" },
    { id: "other", name: "其他" }
  ];

  let categories = [
    { id: "quality", groupId: "scene", name: "基础 / 质量" },
    { id: "character", groupId: "characterAttrs", name: "人物 / 角色" },
    { id: "lora", groupId: "other", name: "LoRA" },
    { id: "outfit", groupId: "clothing", name: "服装" },
    { id: "pose", groupId: "characterActions", name: "动作 / 姿势" },
    { id: "expression", groupId: "characterActions", name: "表情" },
    { id: "camera", groupId: "scene", name: "镜头 / 构图" },
    { id: "background", groupId: "scene", name: "背景 / 光照" },
    { id: "negative", groupId: "other", name: "负面 / 禁止内容" }
  ];

  let cards = [
    {
      id: examplePositiveCardId,
      categoryId: "quality",
      zh: "示例：高质量动漫风格",
      prompt: "masterpiece, best quality, amazing quality, very aesthetic, anime style, clean lineart",
      image: "previews/example.jpg"
    },
    {
      id: exampleNegativeCardId,
      categoryId: "negative",
      zh: "示例：防止暴露内容",
      prompt: "negative: nsfw, nude, naked, nipples, exposed breasts, exposed genitals, sex, erotic, sexually suggestive",
      image: "previews/sfw.jpg"
    }
  ];

  cards.push(
    {
      id: defaultCardIds.softLight,
      categoryId: "quality",
      zh: "柔和光影",
      prompt: "soft lighting, delicate shadows, gentle color grading, refined details",
      image: ""
    },
    {
      id: defaultCardIds.cinematic,
      categoryId: "quality",
      zh: "电影感质感",
      prompt: "cinematic composition, dramatic lighting, rich atmosphere, depth of field",
      image: ""
    },
    {
      id: defaultCardIds.soloGirl,
      categoryId: "character",
      zh: "单人少女",
      prompt: "1girl, solo, looking at viewer, detailed eyes",
      image: ""
    },
    {
      id: defaultCardIds.casualOutfit,
      categoryId: "outfit",
      zh: "日常服装",
      prompt: "casual outfit, layered clothing, tasteful accessories",
      image: ""
    },
    {
      id: defaultCardIds.kimono,
      categoryId: "outfit",
      zh: "和风服装",
      prompt: "kimono, floral pattern, elegant traditional clothing",
      image: ""
    },
    {
      id: defaultCardIds.standingPose,
      categoryId: "pose",
      zh: "自然站姿",
      prompt: "standing, relaxed pose, natural posture",
      image: ""
    },
    {
      id: defaultCardIds.lookingBack,
      categoryId: "pose",
      zh: "回眸",
      prompt: "looking back, over shoulder, dynamic pose",
      image: ""
    },
    {
      id: defaultCardIds.smile,
      categoryId: "expression",
      zh: "微笑",
      prompt: "gentle smile, soft expression, warm eyes",
      image: ""
    },
    {
      id: defaultCardIds.closeUp,
      categoryId: "camera",
      zh: "特写镜头",
      prompt: "close-up portrait, face focus, shallow depth of field",
      image: ""
    },
    {
      id: defaultCardIds.fullBody,
      categoryId: "camera",
      zh: "全身构图",
      prompt: "full body, centered composition, clean silhouette",
      image: ""
    },
    {
      id: defaultCardIds.cityNight,
      categoryId: "background",
      zh: "夜晚城市",
      prompt: "night city street, neon lights, wet pavement, urban background",
      image: ""
    },
    {
      id: defaultCardIds.garden,
      categoryId: "background",
      zh: "花园背景",
      prompt: "flower garden, sunlight, petals, peaceful background",
      image: ""
    },
    {
      id: defaultCardIds.negativeHands,
      categoryId: "negative",
      zh: "手部修正负面",
      prompt: "negative: bad hands, malformed hands, extra fingers, missing fingers, fused fingers",
      image: ""
    },
    {
      id: defaultCardIds.negativeQuality,
      categoryId: "negative",
      zh: "低质量负面",
      prompt: "negative: low quality, worst quality, blurry, jpeg artifacts, bad anatomy, deformed",
      image: ""
    }
  );

  let outputPools = [
    {
      id: createId("pool"),
      name: "正向固定卡组",
      mode: "fixed",
      target: "positive",
      lockRole: "",
      cardIds: [examplePositiveCardId]
    },
    {
      id: createId("pool"),
      name: "添加卡组1",
      mode: "random",
      target: "positive",
      cardIds: [
        defaultCardIds.casualOutfit,
        defaultCardIds.kimono,
        defaultCardIds.standingPose,
        defaultCardIds.lookingBack,
        defaultCardIds.smile,
        defaultCardIds.closeUp,
        defaultCardIds.fullBody,
        defaultCardIds.cityNight,
        defaultCardIds.garden
      ],
      cardWeights: {
        [defaultCardIds.casualOutfit]: 1,
        [defaultCardIds.kimono]: 1,
        [defaultCardIds.standingPose]: 1,
        [defaultCardIds.lookingBack]: 1,
        [defaultCardIds.smile]: 1,
        [defaultCardIds.closeUp]: 1,
        [defaultCardIds.fullBody]: 1,
        [defaultCardIds.cityNight]: 1,
        [defaultCardIds.garden]: 1
      }
    }
  ];

  let customDrag = null;
  let isLibraryHidden = false;
  let hideNsfwCards = false;
  let libraryCardColumns = 3;
  let collapsedCategoryIds = new Set();
  let libraryCardClipboard = null;
  let expandedOutputPoolId = "";
  let poolPresetCategories = [{ id: "pool_preset_default", name: "默认" }];
  let poolPresets = [];
  let activePoolPresetCategoryId = "pool_preset_default";
  let selectedPoolPresetId = "";
  let suppressLibraryCardClickUntil = 0;
  let draggingCategoryId = "";
  let draggingCategoryGroupId = "";
  let editingCardId = null;
  let activeCategoryGroupId = "";
  let activeCategoryId = "";
  let libraryCategoryPages = {};
  let categoryBatchDialogCategoryId = "";
  let categoryBatchExpandedTags = new Set();
  let categoryBatchGroupRenderLimits = {};
  let forgeLaunchRequested = false;
  let forgeEnterDetailedOnReady = true;
  let forgeGenerationRunning = false;
  let forgeGenerationPaused = false;
  let forgeGenerationStartedAt = 0;
  let forgeGenerationTotal = 0;
  let forgeGenerationTimer = null;
  let currentForgeImages = [];
  let previewGeneratingCardId = null;
  let previewBatchCancelRequested = false;
  let generationHistory = loadGenerationHistory();
  let currentForgeDefaults = null;
  let onboardingGuideState = {
    active: false,
    step: 0,
    manualPosition: false,
    x: 0,
    y: 0
  };
  let onboardingPlacementFrame = null;
  let onboardingTargetElement = null;
  let onboardingDragState = null;
  let imageViewerState = {
    scale: 1,
    x: 0,
    y: 0,
    dragging: false,
    pointerX: 0,
    pointerY: 0,
    currentImage: null,
    images: [],
    index: 0
  };

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getCardById(cardId) {
    return cards.find(card => card.id === cardId);
  }

  function getCategoryById(categoryId) {
    return categories.find(category => category.id === categoryId);
  }

  function getCategoryGroupById(groupId) {
    return categoryGroups.find(group => group.id === groupId);
  }

  function getFallbackCategoryGroupId() {
    return categoryGroups[0]?.id || "other";
  }

  function inferCategoryGroupId(category) {
    const currentGroupId = category?.groupId || "";
    if (getCategoryGroupById(currentGroupId)) return currentGroupId;

    const id = String(category?.id || "").toLowerCase();
    const name = String(category?.name || "").toLowerCase();
    const text = `${id} ${name}`;

    if (/quality|camera|background|style|画面|基础|质量|画风|背景|画幅|视角|光照|色彩|镜头|构图/.test(text)) {
      return "scene";
    }

    if (/character|role|hair|face|body|人物|角色|头发|五官|身材/.test(text)) {
      return "characterAttrs";
    }

    if (/pose|action|expression|hand|leg|动作|姿势|表情|上肢|下肢/.test(text)) {
      return "characterActions";
    }

    if (/outfit|clothing|cloth|shoe|sock|wear|服装|服饰|套装|上衣|下服|裤|裙|袜|鞋|装饰/.test(text)) {
      return "clothing";
    }

    return getCategoryGroupById("other") ? "other" : getFallbackCategoryGroupId();
  }

  function getDefaultCategoryNameForGroup(groupId) {
    if (groupId === "scene") return "基础画风";
    if (groupId === "characterAttrs") return "角色";
    if (groupId === "characterActions") return "基本动作";
    if (groupId === "clothing") return "套装";
    return "其他";
  }

  function normalizeCategoryGroupsAndCategories() {
    const defaultGroups = [
      { id: "scene", name: "画面" },
      { id: "characterAttrs", name: "人物" },
      { id: "clothing", name: "服饰" },
      { id: "characterActions", name: "姿态" },
      { id: "other", name: "其他" }
    ];
    const sourceGroups = (Array.isArray(categoryGroups) && categoryGroups.length > 0 ? categoryGroups : defaultGroups)
      .filter(group => group?.id !== "works")
      .map(group => (
        group?.id === "characterActions" && group.name === "状态"
          ? { ...group, name: "姿态" }
          : group
      ));

    const seenGroupIds = new Set();
    categoryGroups = sourceGroups
      .map(group => ({
        id: group.id || createId("group"),
        name: group.name || "未命名大类"
      }))
      .filter(group => {
        if (seenGroupIds.has(group.id)) return false;
        seenGroupIds.add(group.id);
        return true;
      });

    if (categoryGroups.length === 0) {
      categoryGroups = [{ id: "other", name: "其他" }];
    }

    const validGroupIds = new Set(categoryGroups.map(group => group.id));
    categories.forEach(category => {
      if (category.groupId === "works") {
        category.groupId = "other";
      }

      category.groupId = validGroupIds.has(category.groupId)
        ? category.groupId
        : inferCategoryGroupId(category);
    });

    categoryGroups.forEach(group => {
      if (categories.some(category => category.groupId === group.id)) return;
      if (group.id === "other") return;

      categories.push({
        id: createId("cat"),
        groupId: group.id,
        name: getDefaultCategoryNameForGroup(group.id)
      });
    });

    categories = categories
      .map((category, index) => ({ category, index }))
      .sort((left, right) => {
        const leftGroupIndex = categoryGroups.findIndex(group => group.id === left.category.groupId);
        const rightGroupIndex = categoryGroups.findIndex(group => group.id === right.category.groupId);

        return (leftGroupIndex < 0 ? Number.MAX_SAFE_INTEGER : leftGroupIndex) -
          (rightGroupIndex < 0 ? Number.MAX_SAFE_INTEGER : rightGroupIndex) ||
          left.index - right.index;
      })
      .map(item => item.category);
  }

  function getCategoriesInGroup(groupId) {
    return categories.filter(category => category.groupId === groupId);
  }

  function hasAnglePrompt(prompt) {
    return /<[^>]+>/.test(String(prompt || ""));
  }

  function parsePromptEmbeddedStrength(prompt) {
    const text = String(prompt || "");
    const numericPattern = "(-?\\d+(?:\\.\\d+)?)";
    const anglePattern = new RegExp(`<[^<>]*:${numericPattern}\\s*>`, "g");
    const bracketPattern = new RegExp(`[\\(\\[][^\\(\\)\\[\\]]*:${numericPattern}\\s*[\\)\\]]`, "g");
    const patterns = [anglePattern, bracketPattern];
    let firstStrength = null;

    for (const pattern of patterns) {
      let match;

      while ((match = pattern.exec(text))) {
        const value = Number(match[1]);

        if (Number.isFinite(value)) {
          if (firstStrength === null) {
            firstStrength = value;
          }

          if (Math.abs(value - 1) >= 0.001) {
            return value;
          }
        }
      }
    }

    return firstStrength;
  }

  function hasLockedEmbeddedStrength(prompt) {
    const embeddedStrength = parsePromptEmbeddedStrength(prompt);
    return embeddedStrength !== null && Math.abs(embeddedStrength - 1) >= 0.001;
  }

  function updateAnglePromptStrength(prompt, strength) {
    const formatted = formatPromptStrength(strength);
    return String(prompt || "").replace(/<([^>]+)>/g, (_match, content) => {
      const parts = String(content || "").split(":");

      if (parts.length > 1 && /^-?\d+(?:\.\d+)?$/.test(parts[parts.length - 1].trim())) {
        parts[parts.length - 1] = formatted;
        return `<${parts.join(":")}>`;
      }

      return `<${content}:${formatted}>`;
    });
  }

  function getFirstCategoryId() {
    normalizeCategoryGroupsAndCategories();

    if (categories.length === 0) {
      categories.push({ id: createId("cat"), groupId: getFallbackCategoryGroupId(), name: "默认分类" });
    }

    return categories[0].id;
  }

  function ensureActiveCategoryId() {
    getFirstCategoryId();
    normalizeCategoryGroupsAndCategories();

    if (activeCategoryGroupId === "works") {
      activeCategoryGroupId = "other";
    }

    if (!getCategoryGroupById(activeCategoryGroupId)) {
      activeCategoryGroupId = getCategoryById(activeCategoryId)?.groupId || categories[0].groupId || getFallbackCategoryGroupId();
    }

    if (!categories.some(category => category.id === activeCategoryId)) {
      const firstInGroup = getCategoriesInGroup(activeCategoryGroupId)[0];
      activeCategoryId = (firstInGroup || categories[0]).id;
    }

    const activeCategory = getCategoryById(activeCategoryId);
    if (activeCategory && activeCategory.groupId !== activeCategoryGroupId) {
      activeCategoryGroupId = activeCategory.groupId;
    }

    return activeCategoryId;
  }

  function getUniqueCategoryName(baseName) {
    const existingNames = new Set(categories.map(category => category.name));
    let index = 1;
    let name = `${baseName} ${index}`;

    while (existingNames.has(name)) {
      index += 1;
      name = `${baseName} ${index}`;
    }

    return name;
  }

  function getUniqueCategoryGroupName(baseName) {
    const existingNames = new Set(categoryGroups.map(group => group.name));
    let index = 1;
    let name = `${baseName} ${index}`;

    while (existingNames.has(name)) {
      index += 1;
      name = `${baseName} ${index}`;
    }

    return name;
  }

  function getCategoryGroupDeleteTarget(groupId) {
    return categoryGroups.find(group => group.id !== groupId && group.id === "other") ||
      categoryGroups.find(group => group.id !== groupId) ||
      null;
  }

  function addCategoryGroup() {
    normalizeCategoryGroupsAndCategories();

    const group = {
      id: createId("group"),
      name: getUniqueCategoryGroupName("新大类")
    };

    categoryGroups.push(group);
    activeCategoryGroupId = group.id;

    const category = {
      id: createId("cat"),
      groupId: group.id,
      name: getUniqueCategoryName("新分类")
    };
    categories.push(category);
    activeCategoryId = category.id;

    refreshCategorySelects();
    renderLibrary();
  }

  async function renameActiveCategoryGroup() {
    normalizeCategoryGroupsAndCategories();
    ensureActiveCategoryId();

    const group = getCategoryGroupById(activeCategoryGroupId);
    if (!group) {
      alert("大分类不存在。");
      return;
    }

    const nextName = await showPromptDialog("输入新的大分类名称", group.name);
    const cleaned = String(nextName || "").trim();
    if (!cleaned || cleaned === group.name) return;

    const duplicate = categoryGroups.some(item => item.id !== group.id && item.name === cleaned);
    if (duplicate) {
      alert("已经有同名大分类。");
      return;
    }

    group.name = cleaned;
    refreshCategorySelects();
    renderLibrary();
    renderOutputPools();
  }

  async function deleteActiveCategoryGroup() {
    normalizeCategoryGroupsAndCategories();
    ensureActiveCategoryId();

    if (categoryGroups.length <= 1) {
      alert("至少需要保留一个大分类。");
      return;
    }

    const group = getCategoryGroupById(activeCategoryGroupId);
    if (!group) {
      alert("大分类不存在。");
      return;
    }

    const targetGroup = getCategoryGroupDeleteTarget(group.id);
    if (!targetGroup) {
      alert("没有可用于接收小分类的大分类。");
      return;
    }

    const movedCategories = categories.filter(category => category.groupId === group.id);
    const movedCardCount = movedCategories.reduce((total, category) => (
      total + cards.filter(card => card.categoryId === category.id).length
    ), 0);
    const confirmed = await showConfirmDialog(
      `确定删除大分类“${group.name}”吗？其中 ${movedCategories.length} 个小分类、${movedCardCount} 张卡片会移动到“${targetGroup.name}”。`,
      { okText: "删除" }
    );
    if (!confirmed) return;

    movedCategories.forEach(category => {
      category.groupId = targetGroup.id;
    });

    categoryGroups = categoryGroups.filter(item => item.id !== group.id);
    activeCategoryGroupId = targetGroup.id;
    activeCategoryId = movedCategories[0]?.id || getCategoriesInGroup(targetGroup.id)[0]?.id || "";
    ensureActiveCategoryId();

    refreshCategorySelects();
    renderLibrary();
    renderOutputPools();
  }

  function isInteractiveElement(element) {
    return Boolean(
      element.closest("button") ||
      element.closest("input") ||
      element.closest("select") ||
      element.closest("textarea")
    );
  }

  function updateLibraryVisibilityUi() {
    const body = document.getElementById("libraryBody");
    const button = document.getElementById("toggleLibraryButton");

    if (body) {
      body.classList.toggle("hidden", isLibraryHidden);
    }

    if (button) {
      button.textContent = isLibraryHidden ? "显示卡片库" : "隐藏卡片库";
    }
  }

  function toggleLibraryPanel() {
    isLibraryHidden = !isLibraryHidden;
    updateLibraryVisibilityUi();
  }

  function cardHasTag(card, tagName) {
    const expected = String(tagName || "").trim().toLowerCase();
    if (!expected) return false;

    return String(card?.tags || "")
      .split(/[,，;；、\s]+/)
      .map(tag => tag.trim().toLowerCase())
      .filter(Boolean)
      .includes(expected);
  }

  function getCardTags(card) {
    return Array.from(new Set(
      String(card?.tags || "")
        .split(/[,，;；、]+/)
        .map(tag => tag.trim())
        .filter(Boolean)
    ));
  }

  function updateNsfwToggleButton() {
    const button = document.getElementById("toggleNsfwCardsButton");
    if (!button) return;

    button.textContent = hideNsfwCards ? "SFW" : "全部";
    button.title = hideNsfwCards ? "当前仅显示 SFW 卡片，点击显示全部" : "当前显示全部卡片，点击仅显示 SFW";
    button.classList.toggle("is-active", hideNsfwCards);
  }

  function toggleNsfwCardVisibility() {
    hideNsfwCards = !hideNsfwCards;
    updateNsfwToggleButton();
    renderLibrary();
  }

  function normalizeLibraryCardColumns(value) {
    const number = Number(value);
    if ([2, 3, 4, 5].includes(number)) return number;
    return 3;
  }

  function applyLibraryCardColumns() {
    libraryCardColumns = normalizeLibraryCardColumns(libraryCardColumns);

    const body = document.getElementById("libraryBody");
    if (body) {
      body.style.setProperty("--library-card-columns", String(libraryCardColumns));
      body.dataset.cardColumns = String(libraryCardColumns);
    }

    const button = document.getElementById("toggleLibraryCardColumnsButton");
    if (button) {
      button.textContent = `${libraryCardColumns}列`;
      button.title = `当前每行显示 ${libraryCardColumns} 张卡片，点击切换`;
    }
  }

  function toggleLibraryCardColumns() {
    const options = [2, 3, 4, 5];
    const currentIndex = options.indexOf(normalizeLibraryCardColumns(libraryCardColumns));
    libraryCardColumns = options[(currentIndex + 1) % options.length];
    applyLibraryCardColumns();
  }

  function toggleCategoryVisibility(categoryId) {
    if (collapsedCategoryIds.has(categoryId)) {
      collapsedCategoryIds.delete(categoryId);
    } else {
      collapsedCategoryIds.add(categoryId);
    }

    renderLibrary();
  }

  function collapseAllCategories() {
    collapsedCategoryIds = new Set(categories.map(category => category.id));
    renderLibrary();
  }

  function expandAllCategories() {
    collapsedCategoryIds = new Set();
    renderLibrary();
  }

  function clearDropMarkers() {
    document.querySelectorAll(".drop-before, .drop-after, .drop-zone-active").forEach(element => {
      element.classList.remove("drop-before", "drop-after", "drop-zone-active");
    });
  }

  function clearDragArtifacts() {
    document.querySelectorAll(".drag-clone").forEach(element => {
      element.remove();
    });

    document.querySelectorAll(".drag-source").forEach(element => {
      element.classList.remove("drag-source");
    });
  }

  function updateDragCloneState() {
    if (!customDrag?.clone) return;

    customDrag.clone.classList.toggle(
      "drag-remove-target",
      customDrag.drop?.kind === "remove-pool-card"
    );
  }

  function clearCustomDrag() {
    clearDropMarkers();
    clearDragArtifacts();

    if (customDrag && customDrag.autoScrollFrame) {
      cancelAnimationFrame(customDrag.autoScrollFrame);
    }

    clearDragCategorySwitchTimer();

    if (customDrag && customDrag.clone) {
      customDrag.clone.remove();
    }

    if (customDrag && customDrag.sourceElement) {
      customDrag.sourceElement.classList.remove("drag-source");
    }

    customDrag = null;

    document.removeEventListener("mousemove", handleCustomDragMove);
    document.removeEventListener("mouseup", handleCustomDragEnd);
  }

  function releaseModalFocus() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    window.setTimeout(() => {
      window.focus();
    }, 0);
  }

  function showConfirmDialog(message, options = {}) {
    const dialog = document.getElementById("confirmDialog");
    const messageElement = document.getElementById("confirmDialogMessage");
    const inputElement = document.getElementById("confirmDialogInput");
    const checkboxRow = document.getElementById("confirmDialogCheckboxRow");
    const checkboxElement = document.getElementById("confirmDialogCheckbox");
    const checkboxLabel = document.getElementById("confirmDialogCheckboxLabel");
    const okButton = document.getElementById("confirmDialogOk");
    const cancelButton = document.getElementById("confirmDialogCancel");

    if (!dialog || !messageElement || !inputElement || !okButton || !cancelButton) {
      return Promise.resolve(false);
    }

    clearCustomDrag();
    messageElement.textContent = message;
    okButton.textContent = options.okText || "确定";
    cancelButton.textContent = options.cancelText || "取消";
    cancelButton.hidden = options.showCancel === false;
    inputElement.classList.add("hidden");
    inputElement.value = "";
    const hasCheckbox = Boolean(options.checkboxLabel && checkboxRow && checkboxElement && checkboxLabel);
    if (checkboxRow && checkboxElement && checkboxLabel) {
      checkboxRow.classList.toggle("hidden", !hasCheckbox);
      checkboxLabel.textContent = hasCheckbox ? String(options.checkboxLabel) : "";
      checkboxElement.checked = Boolean(options.checkboxChecked);
    }
    okButton.classList.toggle("confirm-dialog-neutral", options.primaryTone === "neutral");
    dialog.classList.remove("hidden");
    dialog.setAttribute("aria-hidden", "false");

    return new Promise(resolve => {
      const cleanup = value => {
        const result = hasCheckbox
          ? { confirmed: Boolean(value), checked: Boolean(checkboxElement?.checked) }
          : value;
        dialog.classList.add("hidden");
        dialog.setAttribute("aria-hidden", "true");
        okButton.onclick = null;
        cancelButton.onclick = null;
        cancelButton.hidden = false;
        inputElement.classList.add("hidden");
        inputElement.value = "";
        if (checkboxRow && checkboxElement && checkboxLabel) {
          checkboxRow.classList.add("hidden");
          checkboxLabel.textContent = "";
          checkboxElement.checked = false;
        }
        okButton.classList.remove("confirm-dialog-neutral");
        dialog.onmousedown = null;
        document.removeEventListener("keydown", onKeyDown, true);
        clearCustomDrag();
        releaseModalFocus();
        resolve(result);
      };

      const onKeyDown = event => {
        if (event.key === "Escape") {
          event.preventDefault();
          cleanup(false);
        }

        if (event.key === "Enter") {
          event.preventDefault();
          cleanup(true);
        }
      };

      okButton.onclick = () => cleanup(true);
      cancelButton.onclick = () => cleanup(false);
      dialog.onmousedown = event => {
        if (event.target === dialog) {
          cleanup(false);
        }
      };
      document.addEventListener("keydown", onKeyDown, true);
      (options.showCancel === false ? okButton : cancelButton).focus();
    });
  }

  function showAlertDialog(message) {
    return showConfirmDialog(String(message || ""), {
      okText: "知道了",
      showCancel: false,
      primaryTone: "neutral"
    });
  }

  function showPromptDialog(message, defaultValue = "") {
    const dialog = document.getElementById("confirmDialog");
    const messageElement = document.getElementById("confirmDialogMessage");
    const inputElement = document.getElementById("confirmDialogInput");
    const okButton = document.getElementById("confirmDialogOk");
    const cancelButton = document.getElementById("confirmDialogCancel");

    if (!dialog || !messageElement || !inputElement || !okButton || !cancelButton) {
      return Promise.resolve(null);
    }

    clearCustomDrag();
    messageElement.textContent = String(message || "");
    inputElement.value = String(defaultValue || "");
    inputElement.classList.remove("hidden");
    okButton.textContent = "确定";
    cancelButton.textContent = "取消";
    cancelButton.hidden = false;
    okButton.classList.remove("confirm-dialog-neutral");
    dialog.classList.remove("hidden");
    dialog.setAttribute("aria-hidden", "false");

    return new Promise(resolve => {
      const cleanup = value => {
        dialog.classList.add("hidden");
        dialog.setAttribute("aria-hidden", "true");
        okButton.onclick = null;
        cancelButton.onclick = null;
        dialog.onmousedown = null;
        inputElement.classList.add("hidden");
        inputElement.value = "";
        document.removeEventListener("keydown", onKeyDown, true);
        clearCustomDrag();
        releaseModalFocus();
        resolve(value);
      };

      const onKeyDown = event => {
        if (event.key === "Escape") {
          event.preventDefault();
          cleanup(null);
        }

        if (event.key === "Enter") {
          event.preventDefault();
          cleanup(inputElement.value);
        }
      };

      okButton.onclick = () => cleanup(inputElement.value);
      cancelButton.onclick = () => cleanup(null);
      dialog.onmousedown = event => {
        if (event.target === dialog) {
          cleanup(null);
        }
      };
      document.addEventListener("keydown", onKeyDown, true);
      inputElement.focus();
      inputElement.select();
    });
  }

  window.alert = message => {
    showAlertDialog(message);
  };

  function startCustomDrag(event, data, sourceElement) {
    if (event.button !== 0) return;
    if (isInteractiveElement(event.target)) return;

    event.preventDefault();

    const rect = sourceElement.getBoundingClientRect();
    const clone = sourceElement.cloneNode(true);

    clone.classList.add("drag-clone", `drag-type-${data.type}`);
    clone.style.width = rect.width + "px";
    clone.style.height = rect.height + "px";
    clone.style.left = rect.left + "px";
    clone.style.top = rect.top + "px";

    document.body.appendChild(clone);

    sourceElement.classList.add("drag-source");

    customDrag = {
      data,
      sourceElement,
      clone,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      didMove: false,
      drop: null,
      autoScrollFrame: null
    };

    startDragAutoScrollLoop();
    document.addEventListener("mousemove", handleCustomDragMove);
    document.addEventListener("mouseup", handleCustomDragEnd);
  }

  function handleCustomDragMove(event) {
    if (!customDrag) return;

    event.preventDefault();

    customDrag.x = event.clientX;
    customDrag.y = event.clientY;
    customDrag.didMove = customDrag.didMove ||
      Math.abs(event.clientX - customDrag.startX) > 4 ||
      Math.abs(event.clientY - customDrag.startY) > 4;

    customDrag.clone.style.left = (event.clientX - customDrag.offsetX) + "px";
    customDrag.clone.style.top = (event.clientY - customDrag.offsetY) + "px";

    updateCustomDropTarget(event.clientX, event.clientY);
    updateDragCategorySwitchTarget(event.clientX, event.clientY);
  }

  function startDragAutoScrollLoop() {
    if (!customDrag || customDrag.autoScrollFrame) return;

    const tick = () => {
      if (!customDrag) return;

      const didScroll = performDragAutoScroll(customDrag.x, customDrag.y);
      if (didScroll) {
        updateCustomDropTarget(customDrag.x, customDrag.y);
        updateDragCategorySwitchTarget(customDrag.x, customDrag.y);
      }

      if (customDrag) {
        customDrag.autoScrollFrame = requestAnimationFrame(tick);
      }
    };

    customDrag.autoScrollFrame = requestAnimationFrame(tick);
  }

  function getDragScrollableContainers() {
    return [
      document.querySelector(".sidebar"),
      document.getElementById("categoryTabs"),
      document.scrollingElement || document.documentElement
    ].filter(Boolean);
  }

  function getDragScrollDelta(position, start, end) {
    const edgeSize = 54;
    const maxSpeed = 18;

    if (position < start + edgeSize) {
      return -Math.ceil(((start + edgeSize - position) / edgeSize) * maxSpeed);
    }

    if (position > end - edgeSize) {
      return Math.ceil(((position - (end - edgeSize)) / edgeSize) * maxSpeed);
    }

    return 0;
  }

  function performDragAutoScroll(x, y) {
    if (customDrag?.drop?.kind === "remove-pool-card") return false;

    const containers = getDragScrollableContainers();

    for (const container of containers) {
      const isPage = container === document.scrollingElement || container === document.documentElement;
      const rect = isPage
        ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
        : container.getBoundingClientRect();

      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;

      const canScrollY = isPage
        ? window.innerHeight < document.documentElement.scrollHeight
        : container.scrollHeight > container.clientHeight + 1;
      const canScrollX = !isPage && container.scrollWidth > container.clientWidth + 1;
      const deltaY = canScrollY ? getDragScrollDelta(y, rect.top, rect.bottom) : 0;
      const deltaX = canScrollX ? getDragScrollDelta(x, rect.left, rect.right) : 0;

      if (!deltaX && !deltaY) {
        if (!isPage) return false;
        continue;
      }

      const beforeLeft = isPage ? window.scrollX : container.scrollLeft;
      const beforeTop = isPage ? window.scrollY : container.scrollTop;

      if (isPage) {
        window.scrollBy(deltaX, deltaY);
      } else {
        container.scrollLeft += deltaX;
        container.scrollTop += deltaY;
      }

      const afterLeft = isPage ? window.scrollX : container.scrollLeft;
      const afterTop = isPage ? window.scrollY : container.scrollTop;
      const didScroll = beforeLeft !== afterLeft || beforeTop !== afterTop;

      if (!isPage || didScroll) return didScroll;
    }

    return false;
  }

  function clearDragCategorySwitchTimer() {
    if (!customDrag?.categorySwitchTimer) return;

    clearTimeout(customDrag.categorySwitchTimer);
    customDrag.categorySwitchTimer = null;
    customDrag.categorySwitchTarget = "";
  }

  function getCategorySwitchTargetFromElement(element) {
    const tab = element?.closest?.(".category-tab:not(.category-add-tab)");
    return tab?.dataset?.categoryId || "";
  }

  function updateDragCategorySwitchTarget(x, y) {
    if (customDrag?.data?.type === "library-card") {
      clearDragCategorySwitchTimer();
      return;
    }

    if (!customDrag || customDrag.data?.type !== "library-card") {
      clearDragCategorySwitchTimer();
      return;
    }

    const detailedApp = document.getElementById("detailedApp");
    if (detailedApp?.dataset.page !== "market") {
      clearDragCategorySwitchTimer();
      return;
    }

    const targetCategoryId = getCategorySwitchTargetFromElement(document.elementFromPoint(x, y));
    const currentCategoryId = ensureActiveCategoryId();

    if (!targetCategoryId || targetCategoryId === currentCategoryId || !getCategoryById(targetCategoryId)) {
      clearDragCategorySwitchTimer();
      return;
    }

    if (customDrag.categorySwitchTarget === targetCategoryId && customDrag.categorySwitchTimer) return;

    clearDragCategorySwitchTimer();
    customDrag.categorySwitchTarget = targetCategoryId;
    customDrag.categorySwitchTimer = setTimeout(() => {
      if (!customDrag || customDrag.categorySwitchTarget !== targetCategoryId) return;

      activeCategoryId = targetCategoryId;
      collapsedCategoryIds.delete(targetCategoryId);
      renderLibrary();
      customDrag.categorySwitchTimer = null;
      customDrag.categorySwitchTarget = "";
      updateCustomDropTarget(customDrag.x, customDrag.y);
    }, 550);
  }

  function handleCustomDragEnd(event) {
    if (!customDrag) return;

    event.preventDefault();

    const dragData = customDrag.data;
    const drop = customDrag.drop;
    const didMove = Boolean(customDrag.didMove);
    const clickAddPoolId = !drop && !didMove && dragData.type === "library-card"
      ? getExpandedOutputPool()?.id || ""
      : "";

    const shouldRenderLibrary = drop && (
      drop.kind === "library-card" ||
      drop.kind === "library-category" ||
      drop.kind === "output-pool" ||
      drop.kind === "remove-pool-card"
    );

    const shouldRenderPools = drop && (
      drop.kind === "output-pool" ||
      drop.kind === "remove-pool-card" ||
      drop.kind === "output-pool-order"
    );

    if (drop) {
      if (dragData.type === "library-card") {
        if (drop.kind === "library-card" && isLibraryEditMode()) {
          if (dragData.cardId !== drop.targetCardId && dragData.sourceCategoryId === drop.targetCategoryId) {
            moveLibraryCardBeforeOrAfter(
              dragData.cardId,
              drop.targetCategoryId,
              drop.targetCardId,
              drop.insertAfter
            );
          }
        }

        if (drop.kind === "output-pool") {
          addOrMoveCardInPool(
            drop.targetPoolId,
            dragData.cardId,
            null,
            true
          );
        }
      }

      if (dragData.type === "pool-card") {
        if (drop.kind === "remove-pool-card") {
          removeCardFromPool(dragData.sourcePoolId, dragData.cardId);
        }
      }

      if (dragData.type === "output-pool-order" && drop.kind === "output-pool-order") {
        moveOutputPoolBeforeOrAfter(
          dragData.poolId,
          drop.targetPoolId,
          drop.insertAfter
        );
      }
    }

    if ((drop || didMove || clickAddPoolId) && dragData.type === "library-card") {
      suppressLibraryCardClickUntil = Date.now() + 250;
    }

    clearCustomDrag();

    if (clickAddPoolId) {
      addCardToPool(clickAddPoolId, dragData.cardId);
    }

    if (shouldRenderLibrary) {
      renderLibrary();
    }

    if (shouldRenderPools) {
      renderOutputPools();
      generatePrompt();
    }
  }

  function getCategoryDragId(event) {
    return event.dataTransfer?.getData("application/x-prompt-category") ||
      event.dataTransfer?.getData("text/plain") ||
      "";
  }

  function isCategoryDragEvent(event) {
    return Array.from(event.dataTransfer?.types || []).includes("application/x-prompt-category");
  }

  function getCategoryGroupDragId(event) {
    return event.dataTransfer?.getData("application/x-prompt-category-group") || "";
  }

  function isCategoryGroupDragEvent(event) {
    return Array.from(event.dataTransfer?.types || []).includes("application/x-prompt-category-group");
  }

  function handleOutputPoolCategoryDragOver(event) {
    if (!isCategoryDragEvent(event) && !isCategoryGroupDragEvent(event)) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.add("drop-zone-active");
    event.dataTransfer.dropEffect = "copy";
  }

  function handleOutputPoolCategoryDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      event.currentTarget.classList.remove("drop-zone-active");
    }
  }

  function handleOutputPoolCategoryDrop(event) {
    if (!isCategoryDragEvent(event) && !isCategoryGroupDragEvent(event)) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove("drop-zone-active");

    if (isCategoryGroupDragEvent(event)) {
      addCategoryGroupToPool(event.currentTarget.dataset.poolId, getCategoryGroupDragId(event));
    } else {
      addCategoryToPool(event.currentTarget.dataset.poolId, getCategoryDragId(event));
    }
  }

  function updateCustomDropTarget(x, y) {
    if (!customDrag) return;

    clearDropMarkers();
    customDrag.drop = null;
    updateDragCloneState();

    const element = document.elementFromPoint(x, y);
    if (!element) return;

    const dragData = customDrag.data;

    const libraryCard = element.closest(".library-card");
    const poolCard = element.closest(".pool-card");
    const outputPool = element.closest(".output-pool");
    const outputPoolEditable = isOutputPoolEditable();

    if (dragData.type === "library-card") {
      if (outputPool && outputPoolEditable) {
        const targetPoolId = outputPool.dataset.poolId;
        outputPool.classList.add("drop-zone-active");

        customDrag.drop = {
          kind: "output-pool",
          targetPoolId
        };
        updateDragCloneState();

        return;
      }

      if (libraryCard && isLibraryEditMode()) {
        const targetCardId = libraryCard.dataset.cardId;
        const targetCategoryId = libraryCard.dataset.categoryId;

        if (targetCardId === dragData.cardId || targetCategoryId !== dragData.sourceCategoryId) return;

        const insertAfter = isAfterMiddle(x, y, libraryCard);

        libraryCard.classList.add(insertAfter ? "drop-after" : "drop-before");

        customDrag.drop = {
          kind: "library-card",
          targetCategoryId,
          targetCardId,
          insertAfter
        };
        updateDragCloneState();

        return;
      }
    }

    if (dragData.type === "pool-card" && outputPoolEditable) {
      if (outputPool) {
        customDrag.drop = null;
        updateDragCloneState();
        return;
      }

      customDrag.drop = {
        kind: "remove-pool-card",
        sourcePoolId: dragData.sourcePoolId,
        cardId: dragData.cardId
      };
      updateDragCloneState();
    }

    if (dragData.type === "output-pool-order" && outputPool) {
      const targetPoolId = outputPool.dataset.poolId;
      const sourcePool = outputPools.find(pool => pool.id === dragData.poolId);
      const targetPool = outputPools.find(pool => pool.id === targetPoolId);

      if (!sourcePool || !targetPool || sourcePool.id === targetPool.id) {
        updateDragCloneState();
        return;
      }

      const insertAfter = isAfterMiddle(x, y, outputPool);
      outputPool.classList.add(insertAfter ? "drop-after" : "drop-before");

      customDrag.drop = {
        kind: "output-pool-order",
        targetPoolId,
        insertAfter
      };
      updateDragCloneState();
    }
  }

  function isAfterMiddle(x, y, element) {
    const rect = element.getBoundingClientRect();

    if (element.classList.contains("pool-card")) {
      return y > rect.top + rect.height / 2;
    }

    const horizontalAfter = x > rect.left + rect.width / 2;
    const verticalAfter = y > rect.top + rect.height / 2;

    if (Math.abs(y - (rect.top + rect.height / 2)) > rect.height * 0.25) {
      return verticalAfter;
    }

    return horizontalAfter;
  }

  function isLibraryEditMode() {
    const detailedApp = document.getElementById("detailedApp");
    return detailedApp?.dataset.page === "market";
  }

  function isOutputPoolEditable() {
    return true;
  }

  function getExpandedOutputPool() {
    return outputPools.find(pool => pool.id === expandedOutputPoolId) || null;
  }

  function hasExpandedOutputPool() {
    return Boolean(getExpandedOutputPool());
  }

  function isCardInAnyOutputPool(cardId) {
    return outputPools.some(pool => Array.isArray(pool.cardIds) && pool.cardIds.includes(cardId));
  }

  function categoryHasSelectedCards(categoryId) {
    return cards.some(card => card.categoryId === categoryId && isCardInAnyOutputPool(card.id));
  }

  function categoryGroupHasSelectedCards(groupId) {
    const categoryIds = new Set(getCategoriesInGroup(groupId).map(category => category.id));
    return cards.some(card => categoryIds.has(card.categoryId) && isCardInAnyOutputPool(card.id));
  }

  function getCardCategoryGroupName(card) {
    const category = getCategoryById(card?.categoryId);
    const group = category ? getCategoryGroupById(category.groupId) : null;

    return group?.name || "未分类";
  }

  function getOrCreateCategoryGroupPoolForCard(card) {
    normalizeOutputPools();

    const poolName = getCardCategoryGroupName(card);
    let pool = outputPools.find(item => item.name === poolName);

    if (!pool) {
      pool = {
        id: createId("pool"),
        name: poolName,
        mode: "all",
        target: "positive",
        lockRole: "",
        cardIds: [],
        cardWeights: {},
        cardStrengths: {}
      };
      outputPools.push(pool);
    }

    return pool;
  }

  function toggleCardInBestOutputPool(cardId) {
    const card = getCardById(cardId);
    if (!card) return;

    const expandedPool = getExpandedOutputPool();
    const targetPool = expandedPool || getOrCreateCategoryGroupPoolForCard(card);

    if (Array.isArray(targetPool.cardIds) && targetPool.cardIds.includes(card.id)) {
      removeCardFromPool(targetPool.id, card.id);
      return;
    }

    addCardToPool(targetPool.id, card.id);
    advanceOnboardingAfterCardAdded(card.id, targetPool.id);
  }

  function toggleOutputPoolExpanded(poolId) {
    expandedOutputPoolId = expandedOutputPoolId === poolId ? "" : poolId;
    renderOutputPools();
    advanceOnboardingAfterPoolToggle(poolId);
  }

  function refreshCategorySelects() {
    const selectIds = [
      "editCardCategory"
    ];

    selectIds.forEach(selectId => {
      const select = document.getElementById(selectId);
      if (!select) return;

      const oldValue = select.value;
      select.innerHTML = "";

      normalizeCategoryGroupsAndCategories();
      categories.forEach(category => {
        const option = document.createElement("option");
        const group = getCategoryGroupById(category.groupId);
        option.value = category.id;
        option.textContent = group ? `${group.name} / ${category.name}` : category.name;
        select.appendChild(option);
      });

      const values = Array.from(select.options).map(option => option.value);

      if (values.includes(oldValue)) {
        select.value = oldValue;
      } else {
        select.value = getFirstCategoryId();
      }
    });

    updateRenameCategoryInput();
  }

  function updateRenameCategoryInput() {
    const select = document.getElementById("manageCategorySelect");
    const input = document.getElementById("renameCategoryName");

    if (!select || !input) return;

    const category = getCategoryById(select.value);
    input.value = category ? category.name : "";
  }

  function addDefaultCategory() {
    ensureActiveCategoryId();
    const category = {
      id: createId("cat"),
      groupId: activeCategoryGroupId || getFallbackCategoryGroupId(),
      name: getUniqueCategoryName("新分类")
    };

    categories.push(category);
    activeCategoryId = category.id;

    refreshCategorySelects();
    renderLibrary();
  }

  function addCategory() {
    addDefaultCategory();
  }

  function renameSelectedCategory() {
    const select = document.getElementById("manageCategorySelect");
    if (select) {
      renameCategory(select.value);
    }
  }

  function deleteSelectedCategory() {
    const select = document.getElementById("manageCategorySelect");
    if (select) {
      deleteCategory(select.value);
    }
  }

  function renameCategory(categoryId) {
    const category = getCategoryById(categoryId);

    if (!category) {
      alert("分类不存在。");
      return;
    }

    activeCategoryId = category.id;
    renderLibrary();

    const input = document.getElementById("activeCategoryNameInput");
    if (input) {
      input.focus();
      input.select();
    }
  }

  function moveCategory(categoryId, direction) {
    const index = categories.findIndex(category => category.id === categoryId);

    if (index < 0) return;

    const sourceGroupId = categories[index].groupId;
    const groupCategoryIds = categories
      .filter(category => category.groupId === sourceGroupId)
      .map(category => category.id);
    const groupIndex = groupCategoryIds.indexOf(categoryId);
    const targetCategoryId = groupCategoryIds[groupIndex + direction];
    const nextIndex = categories.findIndex(category => category.id === targetCategoryId);
    if (nextIndex < 0 || nextIndex >= categories.length) return;

    const [category] = categories.splice(index, 1);
    categories.splice(nextIndex, 0, category);
    activeCategoryId = category.id;
    activeCategoryGroupId = category.groupId;

    refreshCategorySelects();
    renderLibrary();
  }

  async function deleteCategory(categoryId) {

    if (categories.length <= 1) {
      alert("至少需要保留一个分类。");
      return;
    }

    const category = getCategoryById(categoryId);

    if (!category) {
      alert("分类不存在。");
      return;
    }

    const categoryCardIds = cards
      .filter(card => card.categoryId === categoryId)
      .map(card => card.id);
    const targetCategory = categories.find(item => item.id !== categoryId && item.groupId === category.groupId) ||
      categories.find(item => item.id !== categoryId);
    const confirmResult = await showConfirmDialog(
      `确定删除分类“${category.name}”吗？取消勾选“移入其他分类”时，该分类下的 ${categoryCardIds.length} 张卡片也会被删除。`,
      {
        okText: "删除",
        checkboxLabel: "移入其他分类",
        checkboxChecked: true
      }
    );
    const confirmed = typeof confirmResult === "object" ? confirmResult.confirmed : confirmResult;
    const moveCardsToOtherCategory = typeof confirmResult === "object" ? confirmResult.checked : true;
    if (!confirmed) return;

    if (moveCardsToOtherCategory && targetCategory) {
      cards.forEach(card => {
        if (card.categoryId === categoryId) {
          cleanupTextGeneratedTagOnCategoryChange(card, targetCategory.id);
          card.categoryId = targetCategory.id;
        }
      });
    } else {
      removeLibraryCardsByIds(categoryCardIds);
    }

    categories = categories.filter(item => item.id !== categoryId);
    collapsedCategoryIds.delete(categoryId);
    delete libraryCategoryPages[categoryId];
    const nextCategory = targetCategory && categories.some(item => item.id === targetCategory.id)
      ? targetCategory
      : categories[0];
    activeCategoryId = nextCategory.id;
    activeCategoryGroupId = nextCategory.groupId;

    refreshCategorySelects();
    renderLibrary();
    refreshOutputPoolsAndLibrary();
  }

  function renderCategoryGroupTabs() {
    const tabs = document.getElementById("categoryGroupTabs");
    if (!tabs) return;

    ensureActiveCategoryId();
    tabs.replaceChildren();

    categoryGroups.forEach(group => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "category-tab category-group-tab";
      button.classList.toggle("active", group.id === activeCategoryGroupId);
      button.classList.toggle("has-selected-cards", categoryGroupHasSelectedCards(group.id));
      button.textContent = group.name;
      button.dataset.groupId = group.id;
      button.draggable = true;
      button.title = "拖到卡组可加入该大类当前页面卡片；拖到其他大分类可排序";
      button.addEventListener("dragstart", handleCategoryGroupDragStart);
      button.addEventListener("dragover", handleCategoryGroupDragOver);
      button.addEventListener("dragleave", handleCategoryGroupDragLeave);
      button.addEventListener("drop", handleCategoryGroupDrop);
      button.addEventListener("dragend", handleCategoryGroupDragEnd);
      button.addEventListener("click", event => {
        event.stopPropagation();
        setActiveCategoryGroup(group.id);
      });
      button.addEventListener("dblclick", event => {
        event.stopPropagation();
        activeCategoryGroupId = group.id;
        renameActiveCategoryGroup();
      });
      tabs.appendChild(button);
    });

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "category-tab category-group-tab category-group-action-tab";
    addButton.textContent = "+";
    addButton.title = "新增大分类";
    addButton.addEventListener("mousedown", preventTabFocusSteal);
    addButton.addEventListener("click", event => {
      event.stopPropagation();
      addCategoryGroup();
    });
    tabs.appendChild(addButton);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "category-tab category-group-tab category-group-action-tab category-group-delete-tab";
    deleteButton.textContent = "删除";
    deleteButton.title = "删除当前大分类，并将其中小分类移动到其他大分类";
    deleteButton.disabled = categoryGroups.length <= 1;
    deleteButton.addEventListener("mousedown", preventTabFocusSteal);
    deleteButton.addEventListener("click", event => {
      event.stopPropagation();
      deleteActiveCategoryGroup();
    });
    tabs.appendChild(deleteButton);
  }

  function renderCategoryTabs() {
    const tabs = document.getElementById("categoryTabs");
    if (!tabs) return;

    const currentCategoryId = ensureActiveCategoryId();
    const visibleCategories = getCategoriesInGroup(activeCategoryGroupId);
    tabs.replaceChildren();

    visibleCategories.forEach(category => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "category-tab";
      button.classList.toggle("active", category.id === currentCategoryId);
      button.classList.toggle("has-selected-cards", categoryHasSelectedCards(category.id));
      button.textContent = category.name;
      button.dataset.categoryId = category.id;

      if (isLibraryEditMode()) {
        button.draggable = true;
        button.title = "拖拽调整分类顺序";
        button.addEventListener("dragstart", handleCategoryDragStart);
        button.addEventListener("dragover", handleCategoryDragOver);
        button.addEventListener("drop", handleCategoryDrop);
        button.addEventListener("dragend", handleCategoryDragEnd);
      } else {
        button.addEventListener("mousedown", preventTabFocusSteal);
      }

      button.addEventListener("click", event => {
        event.stopPropagation();
        setActiveCategory(category.id);
      });
      tabs.appendChild(button);
    });

    if (isLibraryEditMode()) {
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "category-tab category-add-tab";
      addButton.textContent = "+";
      addButton.title = "新增分类";
      addButton.addEventListener("mousedown", preventTabFocusSteal);
      addButton.addEventListener("click", event => {
        event.stopPropagation();
        addDefaultCategory();
      });
      tabs.appendChild(addButton);
    }

    scrollActiveCategoryTabIntoView();
  }

  function scrollActiveCategoryTabIntoView() {
    requestAnimationFrame(() => {
      const tabs = document.getElementById("categoryTabs");
      const activeTab = tabs?.querySelector(".category-tab.active");

      if (!tabs || !activeTab) return;

      const tabsRect = tabs.getBoundingClientRect();
      const tabRect = activeTab.getBoundingClientRect();
      const edgePadding = Math.min(80, Math.max(24, tabsRect.width * 0.18));
      const isNearLeft = tabRect.left < tabsRect.left + edgePadding;
      const isNearRight = tabRect.right > tabsRect.right - edgePadding;

      if (!isNearLeft && !isNearRight) return;

      const tabCenter = activeTab.offsetLeft + activeTab.offsetWidth / 2;
      const targetLeft = Math.max(0, tabCenter - tabs.clientWidth / 2);
      tabs.scrollTo({
        left: targetLeft,
        behavior: "smooth"
      });
    });
  }

  function preventTabFocusSteal(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function clearCategoryDragMarkers() {
    document.querySelectorAll(".category-tab.drag-over-before, .category-tab.drag-over-after, .category-tab.drag-over-group").forEach(tab => {
      tab.classList.remove("drag-over-before", "drag-over-after");
      tab.classList.remove("drag-over-group");
    });
  }

  function handleCategoryDragStart(event) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "copyMove";
    const categoryId = event.currentTarget.dataset.categoryId || "";
    draggingCategoryId = categoryId;
    draggingCategoryGroupId = "";
    event.dataTransfer.setData("application/x-prompt-category", categoryId);
    event.dataTransfer.setData("text/plain", categoryId);
  }

  function handleCategoryDragEnd() {
    draggingCategoryId = "";
    clearCategoryDragMarkers();
  }

  function handleCategoryGroupDragStart(event) {
    event.stopPropagation();
    draggingCategoryId = "";
    draggingCategoryGroupId = event.currentTarget.dataset.groupId || "";
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("application/x-prompt-category-group", draggingCategoryGroupId);
  }

  function handleCategoryGroupDragEnd() {
    draggingCategoryGroupId = "";
    clearCategoryDragMarkers();
  }

  function isSmallCategoryDragEvent(event) {
    return Boolean(draggingCategoryId) ||
      Array.from(event.dataTransfer?.types || []).includes("application/x-prompt-category");
  }

  function getDraggedCategoryId(event) {
    return event.dataTransfer?.getData("application/x-prompt-category") ||
      event.dataTransfer?.getData("text/plain") ||
      draggingCategoryId ||
      "";
  }

  function isCategoryGroupSortDragEvent(event) {
    return Boolean(draggingCategoryGroupId) ||
      Array.from(event.dataTransfer?.types || []).includes("application/x-prompt-category-group");
  }

  function getDraggedCategoryGroupId(event) {
    return event.dataTransfer?.getData("application/x-prompt-category-group") ||
      draggingCategoryGroupId ||
      "";
  }

  function handleCategoryGroupDragOver(event) {
    if (!isLibraryEditMode()) return;

    const targetGroupId = event.currentTarget.dataset.groupId || "";

    if (isSmallCategoryDragEvent(event)) {
      const category = getCategoryById(getDraggedCategoryId(event));

      if (!category || !targetGroupId || category.groupId === targetGroupId) return;

      event.preventDefault();
      event.stopPropagation();
      clearCategoryDragMarkers();
      event.currentTarget.classList.add("drag-over-group");
      event.dataTransfer.dropEffect = "move";
      return;
    }

    if (!isCategoryGroupSortDragEvent(event)) return;

    const sourceGroupId = getDraggedCategoryGroupId(event);
    if (!sourceGroupId || !targetGroupId || sourceGroupId === targetGroupId) return;

    event.preventDefault();
    event.stopPropagation();
    clearCategoryDragMarkers();
    const rect = event.currentTarget.getBoundingClientRect();
    const insertAfter = event.clientX > rect.left + rect.width / 2;
    event.currentTarget.classList.add(insertAfter ? "drag-over-after" : "drag-over-before");
    event.dataTransfer.dropEffect = "move";
  }

  function handleCategoryGroupDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      event.currentTarget.classList.remove("drag-over-group");
    }
  }

  function handleCategoryGroupDrop(event) {
    if (!isLibraryEditMode()) return;

    event.preventDefault();
    event.stopPropagation();

    const targetGroupId = event.currentTarget.dataset.groupId || "";

    clearCategoryDragMarkers();

    if (isSmallCategoryDragEvent(event)) {
      moveCategoryToGroup(getDraggedCategoryId(event), targetGroupId);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const insertAfter = event.clientX > rect.left + rect.width / 2;
    moveCategoryGroupToPosition(getDraggedCategoryGroupId(event), targetGroupId, insertAfter);
  }

  function handleCategoryDragOver(event) {
    if (!isSmallCategoryDragEvent(event)) return;

    event.preventDefault();
    event.stopPropagation();
    clearCategoryDragMarkers();

    const tab = event.currentTarget;
    const rect = tab.getBoundingClientRect();
    const insertAfter = event.clientX > rect.left + rect.width / 2;

    tab.classList.add(insertAfter ? "drag-over-after" : "drag-over-before");
    event.dataTransfer.dropEffect = "move";
  }

  function handleCategoryDrop(event) {
    event.preventDefault();
    event.stopPropagation();

    const sourceId = event.dataTransfer.getData("text/plain");
    const targetId = event.currentTarget.dataset.categoryId;
    const rect = event.currentTarget.getBoundingClientRect();
    const insertAfter = event.clientX > rect.left + rect.width / 2;

    clearCategoryDragMarkers();
    moveCategoryToPosition(sourceId, targetId, insertAfter);
  }

  function moveCategoryToPosition(sourceId, targetId, insertAfter) {
    if (!sourceId || !targetId || sourceId === targetId) return;

    const sourceIndex = categories.findIndex(category => category.id === sourceId);
    const targetIndex = categories.findIndex(category => category.id === targetId);

    if (sourceIndex < 0 || targetIndex < 0) return;
    if (categories[sourceIndex].groupId !== categories[targetIndex].groupId) return;

    const [movingCategory] = categories.splice(sourceIndex, 1);
    const updatedTargetIndex = categories.findIndex(category => category.id === targetId);
    const insertIndex = insertAfter ? updatedTargetIndex + 1 : updatedTargetIndex;

    categories.splice(insertIndex, 0, movingCategory);
    activeCategoryId = movingCategory.id;
    activeCategoryGroupId = movingCategory.groupId;
    refreshCategorySelects();
    renderLibrary();
  }

  function moveCategoryGroupToPosition(sourceId, targetId, insertAfter) {
    if (!sourceId || !targetId || sourceId === targetId) return;

    const sourceIndex = categoryGroups.findIndex(group => group.id === sourceId);
    const targetIndex = categoryGroups.findIndex(group => group.id === targetId);

    if (sourceIndex < 0 || targetIndex < 0) return;

    const [movingGroup] = categoryGroups.splice(sourceIndex, 1);
    const updatedTargetIndex = categoryGroups.findIndex(group => group.id === targetId);
    const insertIndex = insertAfter ? updatedTargetIndex + 1 : updatedTargetIndex;

    categoryGroups.splice(insertIndex, 0, movingGroup);
    activeCategoryGroupId = movingGroup.id;
    activeCategoryId = getCategoriesInGroup(movingGroup.id)[0]?.id || activeCategoryId;

    refreshCategorySelects();
    renderLibrary();
    renderOutputPools();
  }

  function moveCategoryToGroup(categoryId, targetGroupId) {
    if (!categoryId || !targetGroupId) return;

    const categoryIndex = categories.findIndex(category => category.id === categoryId);
    const targetGroup = getCategoryGroupById(targetGroupId);

    if (categoryIndex < 0 || !targetGroup) return;
    if (categories[categoryIndex].groupId === targetGroupId) return;

    const [movingCategory] = categories.splice(categoryIndex, 1);
    movingCategory.groupId = targetGroupId;

    const lastInTargetGroupIndex = categories.reduce((matchedIndex, category, index) => (
      category.groupId === targetGroupId ? index : matchedIndex
    ), -1);

    if (lastInTargetGroupIndex >= 0) {
      categories.splice(lastInTargetGroupIndex + 1, 0, movingCategory);
    } else {
      categories.push(movingCategory);
    }

    activeCategoryId = movingCategory.id;
    activeCategoryGroupId = targetGroupId;

    refreshCategorySelects();
    renderLibrary();
  }

  function renderActiveCategoryToolbar() {
    const input = document.getElementById("activeCategoryNameInput");
    const category = getCategoryById(ensureActiveCategoryId());

    if (input && category && document.activeElement !== input && input.value !== category.name) {
      input.value = category.name;
    }
  }

  function setActiveCategory(categoryId) {
    if (!getCategoryById(categoryId)) return;

    if (customDrag) {
      clearCustomDrag();
    }

    activeCategoryId = categoryId;
    activeCategoryGroupId = getCategoryById(categoryId)?.groupId || activeCategoryGroupId;
    renderLibrary();
  }

  function setActiveCategoryGroup(groupId) {
    if (!getCategoryGroupById(groupId)) return;

    if (customDrag) {
      clearCustomDrag();
    }

    activeCategoryGroupId = groupId;
    const firstCategory = getCategoriesInGroup(groupId)[0];
    if (firstCategory) {
      activeCategoryId = firstCategory.id;
    }
    renderLibrary();
  }

  function saveActiveCategoryName() {
    const input = document.getElementById("activeCategoryNameInput");
    const category = getCategoryById(ensureActiveCategoryId());

    if (!input || !category) return;

    const nextName = input.value.trim();
    if (!nextName) {
      alert("分类名称不能为空。");
      input.value = category.name;
      return;
    }

    if (nextName === category.name) return;

    category.name = nextName;
    refreshCategorySelects();
    renderLibrary();
  }

  function moveActiveCategory(direction) {
    moveCategory(ensureActiveCategoryId(), direction);
  }

  function deleteActiveCategory() {
    deleteCategory(ensureActiveCategoryId());
  }

  function addCardToActiveCategory() {
    addDefaultCardToCategory(ensureActiveCategoryId());
  }

  function compareCategoryCardsForAutoSort(left, right) {
    const leftTags = getCardTags(left.card);
    const rightTags = getCardTags(right.card);
    const leftHasTags = leftTags.length > 0 ? 1 : 0;
    const rightHasTags = rightTags.length > 0 ? 1 : 0;

    if (leftHasTags !== rightHasTags) {
      return leftHasTags - rightHasTags;
    }

    const leftTagText = leftTags.join(", ");
    const rightTagText = rightTags.join(", ");
    const tagCompare = leftTagText.localeCompare(rightTagText, "zh-CN", {
      numeric: true,
      sensitivity: "base"
    });
    if (tagCompare !== 0) return tagCompare;

    const promptCompare = String(left.card.prompt || "").localeCompare(String(right.card.prompt || ""), "zh-CN", {
      numeric: true,
      sensitivity: "base"
    });
    if (promptCompare !== 0) return promptCompare;

    const nameCompare = String(left.card.zh || "").localeCompare(String(right.card.zh || ""), "zh-CN", {
      numeric: true,
      sensitivity: "base"
    });
    if (nameCompare !== 0) return nameCompare;

    return left.index - right.index;
  }

  function sortCategoryCards(categoryId) {
    const category = getCategoryById(categoryId);
    if (!category) return;

    const sortedCards = cards
      .map((card, index) => ({ card, index }))
      .filter(item => item.card.categoryId === category.id)
      .sort(compareCategoryCardsForAutoSort)
      .map(item => item.card);

    if (sortedCards.length <= 1) return;

    let sortedIndex = 0;
    cards = cards.map(card => (
      card.categoryId === category.id ? sortedCards[sortedIndex++] : card
    ));
    libraryCategoryPages[category.id] = 1;

    renderLibrary();
    refreshOutputPoolsAndLibrary();
  }

  function sortActiveCategoryCards() {
    sortCategoryCards(ensureActiveCategoryId());
  }

  async function sortCategoryBatchDialogCards() {
    const categoryId = categoryBatchDialogCategoryId || ensureActiveCategoryId();
    const category = getCategoryById(categoryId);
    const confirmed = await showConfirmDialog(`确定自动排序分类“${category?.name || "当前分类"}”中的卡片吗？`, {
      okText: "自动排序",
      primaryTone: "neutral"
    });
    if (!confirmed) return;

    sortCategoryCards(categoryId);
    renderCategoryBatchDialog();
  }

  function updatePasteLibraryCardButtonState() {
    const button = document.getElementById("pasteLibraryCardButton");
    if (!button) return;

    const hasClipboard = Boolean(libraryCardClipboard);
    const targetCategory = getCategoryById(ensureActiveCategoryId());
    button.disabled = !hasClipboard || !targetCategory;
    button.title = hasClipboard
      ? `粘贴“${libraryCardClipboard.zh || libraryCardClipboard.prompt || "未命名"}”到当前分类`
      : "先复制一张卡片";
  }

  function getLibraryCardCopyPayload(card) {
    if (!card) return null;

    return {
      zh: card.zh || "",
      prompt: card.prompt || "",
      image: card.image || "",
      strength: getCardStrength(card),
      tags: typeof card.tags === "string" ? card.tags : ""
    };
  }

  function copyLibraryCard(cardId) {
    const card = getCardById(cardId);

    if (!card) return;

    libraryCardClipboard = getLibraryCardCopyPayload(card);
    updatePasteLibraryCardButtonState();
  }

  function buildPastedCardName(name) {
    const baseName = String(name || "").trim();
    if (!baseName) return "未命名 副本";

    return /\s副本(?:\s\d+)?$/.test(baseName)
      ? baseName
      : `${baseName} 副本`;
  }

  function insertCardAtCategoryEnd(card) {
    const lastIndex = cards.reduce((matchedIndex, item, index) => (
      item.categoryId === card.categoryId ? index : matchedIndex
    ), -1);

    if (lastIndex >= 0) {
      cards.splice(lastIndex + 1, 0, card);
    } else {
      cards.push(card);
    }
  }

  function pasteLibraryCardToActiveCategory() {
    if (!libraryCardClipboard) {
      alert("请先复制一张卡片。");
      return;
    }

    const categoryId = ensureActiveCategoryId();
    if (!getCategoryById(categoryId)) return;

    const card = {
      id: createId("card"),
      categoryId,
      zh: buildPastedCardName(libraryCardClipboard.zh),
      prompt: libraryCardClipboard.prompt || "",
      image: libraryCardClipboard.image || "",
      strength: clampPromptStrength(libraryCardClipboard.strength ?? 1),
      tags: libraryCardClipboard.tags || ""
    };

    insertCardAtCategoryEnd(card);
    activeCategoryId = categoryId;
    renderLibrary();
    refreshOutputPoolsAndLibrary();
  }

  function getOrCreateGeneratedCategory() {
    const existing = categories.find(category => category.name === "创建");

    if (existing) {
      return existing;
    }

    const category = {
      id: createId("cat"),
      groupId: getCategoryGroupById("other") ? "other" : getFallbackCategoryGroupId(),
      name: "创建"
    };

    categories.push(category);
    refreshCategorySelects();
    return category;
  }

  function isGeneratedCategoryId(categoryId) {
    const category = getCategoryById(categoryId);
    return category?.name === "创建";
  }

  function removeTextGeneratedTag(tags) {
    return String(tags || "")
      .split(",")
      .map(tag => tag.trim())
      .filter(tag => tag && tag !== "文本生成")
      .join(", ");
  }

  function cleanupTextGeneratedTagOnCategoryChange(card, nextCategoryId) {
    if (!card) return;

    if (isGeneratedCategoryId(card.categoryId) && !isGeneratedCategoryId(nextCategoryId)) {
      card.tags = removeTextGeneratedTag(card.tags);
    }
  }

  function stripTextCardLinePrefix(line) {
    return String(line || "")
      .trim()
      .replace(/^[-*•\d.、)\s]+/, "")
      .trim();
  }

  function buildTextCardName(prompt) {
    const text = String(prompt || "").trim();
    const firstPart = text.split(/[,，;；、]/)[0]?.trim() || text;
    return firstPart.length > 28 ? `${firstPart.slice(0, 28)}...` : firstPart;
  }

  function splitLooseTextCardEntries(text) {
    const cleaned = stripTextCardLinePrefix(text);

    if (!cleaned) return [];

    if (/^.{1,48}?(?:\s*\|\s*|\s*[:：]\s*).*$/u.test(cleaned)) {
      return [cleaned];
    }

    return cleaned
      .split(/[\r\n,，;；、]+/)
      .map(stripTextCardLinePrefix)
      .filter(Boolean);
  }

  function splitTextCardEntries(text) {
    const source = String(text || "");
    const entries = [];
    let looseBuffer = "";

    const flushLooseBuffer = () => {
      entries.push(...splitLooseTextCardEntries(looseBuffer));
      looseBuffer = "";
    };

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const closingChar = char === "（" ? "）" : char === "(" ? ")" : "";

      if (!closingChar) {
        looseBuffer += char;
        continue;
      }

      const closeIndex = source.indexOf(closingChar, index + 1);

      if (closeIndex < 0) {
        looseBuffer += char;
        continue;
      }

      flushLooseBuffer();

      const groupedText = stripTextCardLinePrefix(source.slice(index + 1, closeIndex));
      if (groupedText) {
        entries.push(groupedText);
      }

      index = closeIndex;
    }

    flushLooseBuffer();
    return entries;
  }

  function parseTextCardEntry(entry) {
    const text = stripTextCardLinePrefix(entry);

    if (!text) return null;

    const separated = text.match(/^(.{1,48}?)(?:\s*\|\s*|\s*[：:]\s*)(.*)$/u);

    if (separated) {
      const zh = separated[1].trim();
      const prompt = separated[2].trim();
      if (!zh && !prompt) return null;
      return {
        zh: zh || buildTextCardName(prompt) || "未命名",
        prompt
      };
    }

    return {
      zh: buildTextCardName(text),
      prompt: text
    };
  }

  function createCardsFromText(text) {
    const category = getCategoryById(ensureActiveCategoryId());
    if (!category) return 0;

    const parsedCards = splitTextCardEntries(text)
      .map(parseTextCardEntry)
      .filter(Boolean);

    if (parsedCards.length === 0) {
      alert("没有可生成的提示词文本。");
      return 0;
    }

    parsedCards.forEach(item => {
      cards.push({
        id: createId("card"),
        categoryId: category.id,
        zh: item.zh,
        prompt: item.prompt,
        image: "",
        strength: 1,
        tags: ""
      });
    });

    activeCategoryId = category.id;
    collapsedCategoryIds.delete(category.id);
    refreshCategorySelects();
    renderLibrary();
    generatePrompt();
    return parsedCards.length;
  }

  function closeTextCardGenerator() {
    const dialog = document.getElementById("textCardDialog");
    const input = document.getElementById("textCardInput");

    if (dialog) {
      dialog.classList.add("hidden");
      dialog.setAttribute("aria-hidden", "true");
    }

    if (input) {
      input.value = "";
    }

    releaseModalFocus();
  }

  function openTextCardGenerator() {
    const dialog = document.getElementById("textCardDialog");
    const input = document.getElementById("textCardInput");

    if (!dialog || !input) return;

    clearCustomDrag();
    dialog.classList.remove("hidden");
    dialog.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => input.focus());
  }

  function confirmTextCardGenerator() {
    const input = document.getElementById("textCardInput");
    const category = getCategoryById(ensureActiveCategoryId());
    const count = createCardsFromText(input?.value || "");

    if (count > 0) {
      closeTextCardGenerator();
      alert(`已生成 ${count} 张提示词卡片，并放入“${category?.name || "当前"}”分类。`);
    }
  }

  function getLibraryCategoryPage(categoryId, totalCount) {
    const totalPages = Math.max(1, Math.ceil(totalCount / LIBRARY_CARD_PAGE_SIZE));
    const storedPage = Number(libraryCategoryPages[categoryId]);
    const page = Number.isFinite(storedPage) && storedPage > 0 ? Math.floor(storedPage) : 1;
    const clampedPage = Math.min(Math.max(page, 1), totalPages);

    libraryCategoryPages[categoryId] = clampedPage;
    return clampedPage;
  }

  function setLibraryCategoryPage(categoryId, page) {
    libraryCategoryPages[categoryId] = Math.max(1, Math.floor(Number(page) || 1));
    renderLibrary();
  }

  function createLibraryPagination(categoryId, currentPage, totalPages, totalCount) {
    const pagination = document.createElement("div");
    pagination.className = "library-pagination";

    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.textContent = "上一页";
    previousButton.disabled = currentPage <= 1;
    previousButton.addEventListener("click", () => setLibraryCategoryPage(categoryId, currentPage - 1));

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.textContent = "下一页";
    nextButton.disabled = currentPage >= totalPages;
    nextButton.addEventListener("click", () => setLibraryCategoryPage(categoryId, currentPage + 1));

    const pageInfo = document.createElement("div");
    pageInfo.className = "library-pagination-info";
    pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页 · 共 ${totalCount} 张`;

    pagination.append(previousButton, pageInfo, nextButton);
    return pagination;
  }

  function getVisibleCardsForCategoryPage(categoryId) {
    const categoryAllCards = cards.filter(card => card.categoryId === categoryId);
    const categoryCards = hideNsfwCards
      ? categoryAllCards.filter(card => !cardHasTag(card, "NSFW"))
      : categoryAllCards;
    const currentPage = getLibraryCategoryPage(categoryId, categoryCards.length);
    const pageStart = (currentPage - 1) * LIBRARY_CARD_PAGE_SIZE;

    return categoryCards.slice(pageStart, pageStart + LIBRARY_CARD_PAGE_SIZE);
  }

  function renderLibrary() {
    const container = document.getElementById("libraryContainer");

    if (!container) return;

    const currentCategoryId = ensureActiveCategoryId();
    const currentCategory = getCategoryById(currentCategoryId);
    container.innerHTML = "";
    renderCategoryGroupTabs();
    renderCategoryTabs();
    renderActiveCategoryToolbar();
    updateNsfwToggleButton();
    applyLibraryCardColumns();

    if (!currentCategory) return;

    const section = document.createElement("div");
    section.className = "library-category active-library-category";
    section.dataset.categoryId = currentCategory.id;

    const categoryAllCards = cards.filter(card => card.categoryId === currentCategory.id);
    const categoryCards = hideNsfwCards
      ? categoryAllCards.filter(card => !cardHasTag(card, "NSFW"))
      : categoryAllCards;
    const categoryCountText = hideNsfwCards && categoryCards.length !== categoryAllCards.length
      ? `${categoryCards.length} / ${categoryAllCards.length} 张卡片`
      : `${categoryCards.length} 张卡片`;
    const totalPages = Math.max(1, Math.ceil(categoryCards.length / LIBRARY_CARD_PAGE_SIZE));
    const currentPage = getLibraryCategoryPage(currentCategory.id, categoryCards.length);
    const visibleCards = getVisibleCardsForCategoryPage(currentCategory.id);

    section.innerHTML = `
      <div class="category-header">
        <div class="category-title-wrap">
          <div class="category-title">${escapeHtml(currentCategory.name)}</div>
          <div class="category-count">${escapeHtml(categoryCountText)}</div>
        </div>
      </div>
      <div class="library-card-grid"></div>
    `;

    const grid = section.querySelector(".library-card-grid");

    if (categoryCards.length === 0) {
      const empty = document.createElement("div");
      empty.className = "small-hint";
      empty.textContent = hideNsfwCards && categoryAllCards.length > 0
        ? "NSFW 卡片已隐藏。点击标题旁按钮可显示。"
        : isLibraryEditMode()
        ? "暂无卡片。点击 + 卡片生成默认卡片。"
        : "暂无卡片。";
      grid.appendChild(empty);
    } else {
      visibleCards.forEach(card => {
        grid.appendChild(createLibraryCardElement(card));
      });

      if (categoryCards.length > LIBRARY_CARD_PAGE_SIZE) {
        grid.appendChild(createLibraryPagination(currentCategory.id, currentPage, totalPages, categoryCards.length));
      }
    }

    container.appendChild(section);

    updateLibraryVisibilityUi();
    updatePasteLibraryCardButtonState();
    scheduleOnboardingPlacement();
  }

  function createLibraryCardElement(card) {
    const div = document.createElement("div");
    div.className = "library-card";
    div.dataset.cardId = card.id;
    div.dataset.categoryId = card.categoryId;
    div.classList.toggle("selected-in-pool", isCardInAnyOutputPool(card.id));
    const imageSrc = getCardPreviewDisplaySrc(card);

    div.innerHTML = `
      <div class="card-image-wrap">无预览图</div>

      <div class="library-card-body">
        <div class="library-card-zh">${escapeHtml(card.zh || "未命名")}</div>
        <div class="library-card-meta">
          ${String(card.tags || "").split(",").map(tag => tag.trim()).filter(Boolean).slice(0, 3).map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}
        </div>
        <div class="library-card-prompt">${escapeHtml(card.prompt || "空 prompt")}</div>
      </div>

      <div class="library-card-actions">
        <div class="library-card-action-buttons">
          <button class="library-card-edit-button" type="button">编辑</button>
          <button class="library-card-copy-button" type="button">复制</button>
          <button class="library-card-delete-button" type="button">删除</button>
        </div>
      </div>
    `;

    const imageWrap = div.querySelector(".card-image-wrap");
    if (imageWrap && imageSrc) {
      imageWrap.textContent = "";
      const image = document.createElement("img");
      image.draggable = false;
      image.alt = card.zh || "预览图";
      attachRetryingImage(image, imageSrc, {
        fallback: () => {
          imageWrap.textContent = "无预览图";
        }
      });
      imageWrap.appendChild(image);
    }

    const actions = div.querySelector(".library-card-actions");
    if (actions) {
      actions.addEventListener("mousedown", event => event.stopPropagation());
      actions.addEventListener("click", event => event.stopPropagation());
    }

    div.querySelectorAll("input, button").forEach(control => {
      control.addEventListener("mousedown", event => event.stopPropagation());
      control.addEventListener("click", event => event.stopPropagation());
    });

    const editButton = div.querySelector(".library-card-edit-button");
    if (editButton) {
      editButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        editCard(card.id);
      });
    }

    const copyButton = div.querySelector(".library-card-copy-button");
    if (copyButton) {
      copyButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        copyLibraryCard(card.id);
      });
    }

    const deleteButton = div.querySelector(".library-card-delete-button");
    if (deleteButton) {
      deleteButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        deleteCard(card.id);
      });
    }

    div.addEventListener("click", event => {
      if (Date.now() < suppressLibraryCardClickUntil) return;
      if (event.target.closest("button, input, select, textarea, label")) return;

      toggleCardInBestOutputPool(card.id);
    });

    div.addEventListener("mousedown", event => {
      startCustomDrag(event, {
        type: "library-card",
        cardId: card.id,
        sourceCategoryId: card.categoryId
      }, div);
    });

    return div;
  }

  function moveLibraryCardToCategoryEnd(cardId, targetCategoryId) {
    const index = cards.findIndex(card => card.id === cardId);

    if (index < 0) return;

    const [card] = cards.splice(index, 1);
    cleanupTextGeneratedTagOnCategoryChange(card, targetCategoryId);
    card.categoryId = targetCategoryId;

    let insertIndex = -1;

    cards.forEach((item, itemIndex) => {
      if (item.categoryId === targetCategoryId) {
        insertIndex = itemIndex;
      }
    });

    if (insertIndex < 0) {
      cards.push(card);
    } else {
      cards.splice(insertIndex + 1, 0, card);
    }
  }

  function moveLibraryCardBeforeOrAfter(cardId, targetCategoryId, targetCardId, insertAfter) {
    const currentIndex = cards.findIndex(card => card.id === cardId);

    if (currentIndex < 0) return;

    const [movingCard] = cards.splice(currentIndex, 1);
    cleanupTextGeneratedTagOnCategoryChange(movingCard, targetCategoryId);
    movingCard.categoryId = targetCategoryId;

    const targetIndex = cards.findIndex(card => card.id === targetCardId);

    if (targetIndex < 0) {
      cards.push(movingCard);
      return;
    }

    const insertIndex = insertAfter ? targetIndex + 1 : targetIndex;
    cards.splice(insertIndex, 0, movingCard);
  }

  function addDefaultCardToCategory(categoryId) {
    const targetCategoryId = getCategoryById(categoryId) ? categoryId : getFirstCategoryId();
    const card = {
      id: createId("card"),
      categoryId: targetCategoryId,
      zh: "新提示词",
      prompt: "",
      image: "",
      strength: 1,
      tags: ""
    };

    cards.push(card);
    activeCategoryId = targetCategoryId;

    collapsedCategoryIds.delete(targetCategoryId);
    renderLibrary();
    editCard(card.id);
  }

  function addCardFromForm() {
    addDefaultCardToCategory(getFirstCategoryId());
  }

  function editCard(cardId) {
    const card = getCardById(cardId);

    if (!card) return;
    clearCustomDrag();

    editingCardId = cardId;
    refreshCategorySelects();

    const panel = document.getElementById("editCardPanel");
    const category = document.getElementById("editCardCategory");
    const zh = document.getElementById("editCardZh");
    const promptText = document.getElementById("editCardPrompt");
    const image = document.getElementById("editCardImage");
    const tags = document.getElementById("editCardTags");

    if (category) category.value = card.categoryId;
    if (zh) zh.value = card.zh || "";
    if (promptText) promptText.value = card.prompt || "";
    if (image) image.value = card.image || "";
    if (tags) tags.value = card.tags || "";

    if (panel) {
      panel.classList.add("hidden-panel");
      void panel.offsetHeight;
      panel.classList.remove("hidden-panel");
    }

    updateEditCardPreview();
    setEditPreviewStatus("");

    requestAnimationFrame(() => {
      if (panel) {
        panel.scrollTop = 0;
      }
      const dialog = panel?.querySelector(".edit-card-dialog");
      if (dialog) {
        dialog.scrollTop = 0;
      }
      if (zh) {
        zh.focus();
        zh.select();
      }
    });
  }

  function normalizePreviewImageSrc(value) {
    const src = String(value || "").trim();

    if (/^previews[\\/]/i.test(src)) {
      return encodeURI(`../${src.replace(/\\/g, "/")}`);
    }

    if (/^[a-zA-Z]:[\\/]/.test(src)) {
      return encodeURI(`file:///${src.replace(/\\/g, "/")}`);
    }

    return src;
  }

  function addImageCacheBust(src, version) {
    if (!src || !version) return src;
    const separator = src.includes("?") ? "&" : "?";
    return `${src}${separator}v=${encodeURIComponent(String(version))}`;
  }

  function addImageRetryBust(src, attempt) {
    if (!src || attempt <= 0) return src;
    const separator = src.includes("?") ? "&" : "?";
    return `${src}${separator}retry=${attempt}_${Date.now()}`;
  }

  function attachRetryingImage(image, src, options = {}) {
    const maxRetries = options.maxRetries ?? 5;
    const retryDelay = options.retryDelay ?? 450;
    const fallback = typeof options.fallback === "function" ? options.fallback : null;
    let attempt = 0;

    image.loading = options.loading || "eager";
    image.decoding = options.decoding || "sync";
    if ("fetchPriority" in image) {
      image.fetchPriority = options.fetchPriority || "high";
    }

    image.onerror = () => {
      if (attempt < maxRetries) {
        attempt += 1;
        window.setTimeout(() => {
          image.src = addImageRetryBust(src, attempt);
        }, retryDelay * attempt);
        return;
      }

      image.onerror = null;
      if (fallback) fallback();
    };

    image.src = src;
  }

  function getCardPreviewDisplaySrc(card) {
    if (!card?.image) return "";

    return addImageCacheBust(
      normalizePreviewImageSrc(card.image),
      card.previewVersion || ""
    );
  }

  function normalizePreviewImageValue(value) {
    const src = String(value || "").trim();

    if (/^\.\.[\\/]previews[\\/]/i.test(src)) {
      return src.replace(/^\.\.[\\/]/, "").replace(/\\/g, "/");
    }

    if (/^[a-zA-Z]:[\\/]/.test(src)) {
      return encodeURI(`file:///${src.replace(/\\/g, "/")}`);
    }

    return src;
  }

  function updateEditCardPreview() {
    const preview = document.getElementById("editCardImagePreview");
    const input = document.getElementById("editCardImage");

    if (!preview || !input) return;

    const card = getCardById(editingCardId);
    const src = addImageCacheBust(
      normalizePreviewImageSrc(input.value),
      card?.previewVersion || ""
    );
    preview.replaceChildren();

    if (!src) {
      preview.textContent = "暂无预览图像";
      return;
    }

    const image = document.createElement("img");
    image.alt = "预览图像";
    image.title = "点击放大查看";
    image.addEventListener("click", () => {
      openImageViewer({
        src,
        label: card?.zh ? `预览图：${card.zh}` : "预览图像",
        filePath: input.value || "",
        meta: null
      });
    });
    attachRetryingImage(image, src, {
      fallback: () => {
        preview.textContent = "预览图像无法加载";
      }
    });

    preview.appendChild(image);
  }

  async function chooseEditCardImage() {
    if (!window.localApp?.choosePreviewImage) {
      alert("当前环境无法打开图片选择器。");
      return;
    }

    try {
      const result = await window.localApp.choosePreviewImage();
      if (!result || result.canceled || !result.path) return;

      const input = document.getElementById("editCardImage");
      if (input) {
        input.value = result.path;
      }

      updateEditCardPreview();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  }

  function getLatestGeneratedImage() {
    return currentForgeImages.filter(Boolean).at(-1) || generationHistory[0] || null;
  }

  async function useLatestImageAsEditCardPreview() {
    const card = getCardById(editingCardId);
    const latestImage = getLatestGeneratedImage();

    if (!card) return;

    if (!latestImage?.src) {
      alert("还没有可用的最新生图。");
      return;
    }

    if (!window.localApp?.copyPreviewImage) {
      alert("当前环境无法复制预览图。");
      return;
    }

    try {
      const copied = await window.localApp.copyPreviewImage({
        sourceFilePath: latestImage.filePath || "",
        src: latestImage.src,
        previewName: card.zh || buildTextCardName(card.prompt) || card.id,
        previewFolder: getCategoryById(card.categoryId)?.name || ""
      });
      const relativePath = copied?.relativePath || "";

      if (!relativePath) {
        throw new Error("没有返回可用的预览图路径。");
      }

      card.image = relativePath;
      card.previewVersion = Date.now();

      const input = document.getElementById("editCardImage");
      if (input) {
        input.value = relativePath;
      }

      updateEditCardPreview();
      renderLibrary();
      renderOutputPools();
      setEditPreviewStatus("已复制最新生图到 previews，并作为当前卡片预览图。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEditPreviewStatus(message, true);
      alert(message);
    }
  }

  function setEditPreviewStatus(message, isError = false) {
    const status = document.getElementById("editCardPreviewStatus");
    if (!status) return;

    status.textContent = message || "";
    status.classList.toggle("error", Boolean(isError));
  }

  function updateEditingCardFromForm(card) {
    const categoryId = document.getElementById("editCardCategory")?.value || "";
    const zh = document.getElementById("editCardZh")?.value.trim() || "";
    const promptText = document.getElementById("editCardPrompt")?.value.trim() || "";
    const image = normalizePreviewImageValue(document.getElementById("editCardImage")?.value || "");
    const tags = String(document.getElementById("editCardTags")?.value || "").trim();

    if (!zh && !promptText) {
      alert("请填写中文名称或英文 prompts。");
      return false;
    }

    const nextCategoryId = categories.some(category => category.id === categoryId)
      ? categoryId
      : getFirstCategoryId();
    const shouldRemoveTextGeneratedTag = isGeneratedCategoryId(card.categoryId) && !isGeneratedCategoryId(nextCategoryId);

    card.categoryId = nextCategoryId;
    card.zh = zh || promptText || "未命名";
    card.prompt = promptText;
    card.image = image;
    card.tags = shouldRemoveTextGeneratedTag ? removeTextGeneratedTag(tags) : tags;
    return true;
  }

  function cloneOutputPools() {
    return outputPools.map(pool => ({
      ...pool,
      cardIds: Array.isArray(pool.cardIds) ? [...pool.cardIds] : [],
      cardWeights: pool.cardWeights && typeof pool.cardWeights === "object"
        ? { ...pool.cardWeights }
        : {},
      cardStrengths: pool.cardStrengths && typeof pool.cardStrengths === "object"
        ? { ...pool.cardStrengths }
        : {}
    }));
  }

  function buildPromptDataWithPreviewCard(card) {
    normalizeOutputPools();
    const originalPools = cloneOutputPools();

    try {
      let previewPool = outputPools.find(pool => pool.target === "positive" && pool.mode === "fixed") ||
        outputPools.find(pool => pool.target === "positive");

      if (!previewPool) {
        previewPool = {
          id: createId("pool"),
          name: "预览图临时卡组",
          mode: "fixed",
          target: "positive",
          lockRole: "",
          cardIds: [],
          cardWeights: {},
          cardStrengths: {}
        };
        outputPools.unshift(previewPool);
      }

      if (!previewPool.cardIds.includes(card.id)) {
        previewPool.cardIds = [...previewPool.cardIds, card.id];
      }

      return buildPromptData();
    } finally {
      outputPools = originalPools;
      normalizeOutputPools();
    }
  }

  async function generatePreviewForCard(card, options) {
    const width = options?.width ?? getNumberInputValue("forgeWidth", 1024);
    const height = options?.height ?? getNumberInputValue("forgeHeight", 1536);
    const seed = options?.seed ?? getNumberInputValue("forgeSeed", -1);
    const hiresFix = options?.hiresFix ?? isHiresFixEnabled();
    const adetailer = options?.adetailer ?? isADetailerEnabled();
    const slotIndex = Number.isInteger(options?.slotIndex) ? options.slotIndex : -1;
    const data = buildPromptDataWithPreviewCard(card);
    const result = await window.forge.generatePreviewImage({
      prompt: data.positivePrompt,
      negativePrompt: data.finalNegative,
      width,
      height,
      seed,
      hiresFix,
      adetailer,
      adetailerPrompts: buildADetailerPrompts(data.positiveCards),
      previewName: card.zh || buildTextCardName(card.prompt) || card.id,
      previewFolder: options?.previewFolder || getCategoryById(card.categoryId)?.name || "",
      selectedCards: [
        ...data.positiveCards.map(item => getCardSnapshot(item, "positive")),
        ...data.negativeCards.map(item => getCardSnapshot(item, "negative"))
      ]
    });

    const relativePath = result?.image?.previewRelativePath || result?.image?.preview?.relativePath || result?.image?.relativePath || "";
    if (!relativePath) {
      throw new Error("Forge 没有返回可用的预览图路径。");
    }

    if (result.image && slotIndex >= 0) {
      fillForgeImageSlot(slotIndex, {
        ...result.image,
        label: `预览图：${card.zh || card.prompt || "未命名"}`
      });
    }

    card.image = relativePath;
    card.previewVersion = Date.now();
    return { result, relativePath };
  }

  async function generateEditCardPreview() {
    const card = getCardById(editingCardId);

    if (!card || previewGeneratingCardId) return;

    if (!window.forge?.generatePreviewImage) {
      alert("当前环境无法调用 Forge 预览图生成接口。");
      return;
    }

    if (forgeGenerationRunning) {
      alert("当前已有生图任务在运行，请等任务结束后再生成预览图。");
      return;
    }

    if (!updateEditingCardFromForm(card)) return;

    const width = getNumberInputValue("forgeWidth", 1024);
    const height = getNumberInputValue("forgeHeight", 1536);
    const seed = getNumberInputValue("forgeSeed", -1);
    const hiresFix = isHiresFixEnabled();
    const adetailer = isADetailerEnabled();
    const button = document.getElementById("generateEditCardPreviewButton");
    previewGeneratingCardId = card.id;
    if (button) button.disabled = true;
    setForgeGenerationControls(true);
    setEditPreviewStatus(`正在按当前生图参数生成 ${width}x${height} 预览图...`);
    cancelEditCard();
    switchAppPage("images");
    renderForgeImagePlaceholders(1, width, height);
    startForgeGenerationTimer(1);
    updateForgeGenerationProgressStatus("正在生成预览图");

    try {
      const { relativePath } = await generatePreviewForCard(card, {
        width,
        height,
        seed,
        hiresFix,
        adetailer,
        slotIndex: 0
      });
      const imageInput = document.getElementById("editCardImage");
      if (imageInput) {
        imageInput.value = relativePath;
      }

      updateEditCardPreview();
      renderLibrary();
      renderOutputPools();
      generatePrompt();
      setEditPreviewStatus("预览图已生成并引用到当前卡片。");
      setForgeGenerateStatus("预览图生成完成，并已引用到当前卡片。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEditPreviewStatus(message, true);
      setForgeGenerateStatus(message);
      alert(message);
    } finally {
      renderLibrary();
      renderOutputPools();
      generatePrompt();
      stopForgeGenerationTimer();
      setForgeGenerationControls(false);
      forgeGenerationStartedAt = 0;
      forgeGenerationTotal = 0;
      previewGeneratingCardId = null;
      if (button) button.disabled = false;
    }
  }

  async function generateActiveCategoryPreviews() {
    const category = getCategoryById(ensureActiveCategoryId());

    if (!category) return;

    if (!window.forge?.generatePreviewImage) {
      alert("当前环境无法调用 Forge 预览图生成接口。");
      return;
    }

    if (forgeGenerationRunning || previewGeneratingCardId) {
      alert("当前已有生图任务在运行，请等待任务结束后再生成预览图。");
      return;
    }

    const categoryCards = cards.filter(card => card.categoryId === category.id);
    if (categoryCards.length === 0) {
      alert("当前分类下没有卡片。");
      return;
    }

    const confirmResult = await showConfirmDialog(
      `确定为分类“${category.name}”中的 ${categoryCards.length} 张卡片逐张生成预览图吗？未勾选“跳过已有”时，已有预览图会被替换。`,
      {
        okText: "开始生成",
        checkboxLabel: "跳过已有",
        checkboxChecked: false
      }
    );
    const confirmed = typeof confirmResult === "object" ? confirmResult.confirmed : confirmResult;
    const skipExisting = typeof confirmResult === "object" ? confirmResult.checked : false;
    if (!confirmed) return;

    const targetCards = skipExisting
      ? categoryCards.filter(card => !String(card.image || "").trim())
      : categoryCards;

    if (targetCards.length === 0) {
      alert("当前分类下的卡片都已有预览图，无需生成。");
      return;
    }

    const width = getNumberInputValue("forgeWidth", 1024);
    const height = getNumberInputValue("forgeHeight", 1536);
    const seed = getNumberInputValue("forgeSeed", -1);
    const hiresFix = isHiresFixEnabled();
    const adetailer = isADetailerEnabled();
    const button = document.getElementById("generateActiveCategoryPreviewsButton");

    previewGeneratingCardId = `category:${category.id}`;
    previewBatchCancelRequested = false;
    if (button) button.disabled = true;
    cancelEditCard();
    switchAppPage("images");
    renderForgeImagePlaceholders(targetCards.length, width, height);
    setForgeGenerationControls(true);
    startForgeGenerationTimer(targetCards.length);

    try {
      let generatedCount = 0;
      for (let index = 0; index < targetCards.length; index += 1) {
        if (previewBatchCancelRequested) break;

        const card = targetCards[index];
        setForgeGenerateStatus(`正在生成分类“${category.name}”预览图 ${index + 1} / ${targetCards.length}：${card.zh || card.prompt || "未命名"}`);
        try {
          await generatePreviewForCard(card, {
            width,
            height,
            seed,
            hiresFix,
            adetailer,
            slotIndex: index,
            previewFolder: category.name
          });
          generatedCount += 1;
        } catch (error) {
          if (previewBatchCancelRequested) break;
          throw error;
        }
        updateForgeGenerationProgressStatus("已生成预览图");
      }

      renderLibrary();
      renderOutputPools();
      generatePrompt();
      setForgeGenerateStatus(previewBatchCancelRequested
        ? `分类“${category.name}”预览图生成已停止，已完成 ${generatedCount} / ${targetCards.length} 张。`
        : `分类“${category.name}”预览图生成完成，共 ${targetCards.length} 张。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setForgeGenerateStatus(message);
      alert(message);
    } finally {
      renderLibrary();
      renderOutputPools();
      generatePrompt();
      stopForgeGenerationTimer();
      setForgeGenerationControls(false);
      forgeGenerationStartedAt = 0;
      forgeGenerationTotal = 0;
      previewGeneratingCardId = null;
      previewBatchCancelRequested = false;
      if (button) button.disabled = false;
    }
  }

  function cancelEditCard() {
    clearCustomDrag();
    editingCardId = null;

    const panel = document.getElementById("editCardPanel");
    if (panel) {
      panel.classList.add("hidden-panel");
    }

    if (panel && panel.contains(document.activeElement)) {
      document.activeElement.blur();
    }

    requestAnimationFrame(() => {
      if (!document.body.hasAttribute("tabindex")) {
        document.body.tabIndex = -1;
      }
      document.body.focus();
    });
  }

  function saveEditedCard() {
    const card = getCardById(editingCardId);

    if (!card) {
      cancelEditCard();
      return;
    }

    if (!updateEditingCardFromForm(card)) return;

    cancelEditCard();
    renderLibrary();
    refreshOutputPoolsAndLibrary();
  }

  async function deleteCard(cardId) {
    const card = getCardById(cardId);

    if (!card) return;

    const confirmed = await showConfirmDialog(`确定删除卡片“${card.zh}”吗？该卡片也会从所有卡组中移除。`);
    if (!confirmed) return;

    removeLibraryCardsByIds([cardId]);

    renderLibrary();
    refreshOutputPoolsAndLibrary();
  }

  function removeLibraryCardsByIds(cardIds) {
    const removeIds = new Set(cardIds);
    if (removeIds.size === 0) return 0;

    const beforeCount = cards.length;
    cards = cards.filter(item => !removeIds.has(item.id));

    outputPools.forEach(pool => {
      pool.cardIds = pool.cardIds.filter(id => !removeIds.has(id));
      if (pool.cardWeights) {
        removeIds.forEach(cardId => delete pool.cardWeights[cardId]);
      }
      if (pool.cardStrengths) {
        removeIds.forEach(cardId => delete pool.cardStrengths[cardId]);
      }
    });

    return beforeCount - cards.length;
  }

  function getCategoryCardsForBatch(categoryId) {
    return cards.filter(card => card.categoryId === categoryId);
  }

  function getCategoryBatchGroups(categoryId) {
    const groups = new Map();

    getCategoryCardsForBatch(categoryId).forEach(card => {
      const tags = getCardTags(card);
      const keys = tags.length > 0 ? tags : ["无标签"];

      keys.forEach(tag => {
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag).push(card);
      });
    });

    return Array.from(groups.entries())
      .map(([tag, groupCards]) => ({ tag, cards: groupCards }))
      .sort((left, right) => (
        left.tag.localeCompare(right.tag, "zh-CN", { numeric: true, sensitivity: "base" }) ||
        right.cards.length - left.cards.length
      ));
  }

  function closeCategoryBatchDialog() {
    const dialog = document.getElementById("categoryBatchDialog");

    if (dialog) {
      dialog.classList.add("hidden");
      dialog.setAttribute("aria-hidden", "true");
    }

    categoryBatchDialogCategoryId = "";
    categoryBatchExpandedTags = new Set();
    categoryBatchGroupRenderLimits = {};
    releaseModalFocus();
  }

  function openActiveCategoryBatchDialog() {
    const category = getCategoryById(ensureActiveCategoryId());
    const dialog = document.getElementById("categoryBatchDialog");

    if (!category || !dialog) return;

    clearCustomDrag();
    categoryBatchDialogCategoryId = category.id;
    categoryBatchExpandedTags = new Set();
    categoryBatchGroupRenderLimits = {};
    dialog.classList.remove("hidden");
    dialog.setAttribute("aria-hidden", "false");
    renderCategoryBatchDialog();
  }

  function getCategoryBatchGroupKey(tag) {
    return `${categoryBatchDialogCategoryId}::${tag}`;
  }

  function getCategoryBatchGroupRenderLimit(tag, totalCount) {
    const key = getCategoryBatchGroupKey(tag);
    const storedLimit = Number(categoryBatchGroupRenderLimits[key]);
    const limit = Number.isFinite(storedLimit) && storedLimit > 0
      ? storedLimit
      : CATEGORY_BATCH_CARD_RENDER_BATCH_SIZE;

    return Math.min(limit, totalCount);
  }

  function toggleCategoryBatchTagGroup(tag) {
    if (categoryBatchExpandedTags.has(tag)) {
      categoryBatchExpandedTags.delete(tag);
    } else {
      categoryBatchExpandedTags.add(tag);
    }

    renderCategoryBatchDialog();
  }

  function showMoreCategoryBatchTagCards(tag) {
    const key = getCategoryBatchGroupKey(tag);
    const currentLimit = Number(categoryBatchGroupRenderLimits[key]) || CATEGORY_BATCH_CARD_RENDER_BATCH_SIZE;

    categoryBatchGroupRenderLimits[key] = currentLimit + CATEGORY_BATCH_CARD_RENDER_BATCH_SIZE;
    renderCategoryBatchDialog();
  }

  function renderCategoryBatchDialog() {
    const category = getCategoryById(categoryBatchDialogCategoryId);
    const title = document.getElementById("categoryBatchDialogTitle");
    const summary = document.getElementById("categoryBatchSummary");
    const content = document.getElementById("categoryBatchContent");

    if (!category || !title || !summary || !content) return;

    const categoryCards = getCategoryCardsForBatch(category.id);
    const groups = getCategoryBatchGroups(category.id);

    title.textContent = `索引：${category.name}`;
    summary.textContent = `${categoryCards.length} 张卡片 · ${groups.length} 个标签分类`;
    content.replaceChildren();

    if (categoryCards.length === 0) {
      const empty = document.createElement("div");
      empty.className = "category-batch-empty";
      empty.textContent = "当前分类暂无卡片。";
      content.appendChild(empty);
      return;
    }

    groups.forEach(group => {
      const section = document.createElement("section");
      section.className = "category-batch-group";

      const header = document.createElement("div");
      header.className = "category-batch-group-header";

      const label = document.createElement("div");
      label.className = "category-batch-group-title";
      label.textContent = `${group.tag} (${group.cards.length})`;

      const deleteGroupButton = document.createElement("button");
      deleteGroupButton.type = "button";
      deleteGroupButton.className = "category-batch-delete-group";
      deleteGroupButton.textContent = "删除此标签全部";
      deleteGroupButton.addEventListener("click", () => deleteCategoryBatchTagGroup(group.tag));

      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "category-batch-toggle-group";
      toggleButton.textContent = categoryBatchExpandedTags.has(group.tag) ? "收起" : "展开";
      toggleButton.addEventListener("click", () => toggleCategoryBatchTagGroup(group.tag));

      const actionWrap = document.createElement("div");
      actionWrap.className = "category-batch-group-actions";
      actionWrap.append(toggleButton, deleteGroupButton);

      header.append(label, actionWrap);
      section.appendChild(header);

      if (categoryBatchExpandedTags.has(group.tag)) {
        const grid = document.createElement("div");
        grid.className = "category-batch-card-grid";
        const visibleCount = getCategoryBatchGroupRenderLimit(group.tag, group.cards.length);

        group.cards.slice(0, visibleCount).forEach(card => {
          grid.appendChild(createCategoryBatchCardElement(card));
        });

        if (visibleCount < group.cards.length) {
          const loadMore = document.createElement("div");
          loadMore.className = "category-batch-load-more";

          const button = document.createElement("button");
          button.type = "button";
          button.textContent = `继续显示 ${Math.min(CATEGORY_BATCH_CARD_RENDER_BATCH_SIZE, group.cards.length - visibleCount)} 张（${visibleCount} / ${group.cards.length}）`;
          button.addEventListener("click", () => showMoreCategoryBatchTagCards(group.tag));

          loadMore.appendChild(button);
          grid.appendChild(loadMore);
        }

        section.appendChild(grid);
      }

      content.appendChild(section);
    });
  }

  function createCategoryBatchCardElement(card) {
    const item = document.createElement("div");
    item.className = "category-batch-card";
    item.classList.toggle("selected-in-pool", isCardInAnyOutputPool(card.id));
    item.addEventListener("click", event => {
      if (event.target.closest("button, input, select, textarea, label")) return;

      toggleCardInBestOutputPool(card.id);
    });

    const imageWrap = document.createElement("div");
    imageWrap.className = "category-batch-card-image";
    const imageSrc = getCardPreviewDisplaySrc(card);

    if (imageSrc) {
      const image = document.createElement("img");
      image.draggable = false;
      image.alt = card.zh || "预览图";
      attachRetryingImage(image, imageSrc, {
        fallback: () => {
          imageWrap.textContent = "无预览图";
        }
      });
      imageWrap.appendChild(image);
    } else {
      imageWrap.textContent = "无预览图";
    }

    const name = document.createElement("div");
    name.className = "category-batch-card-name";
    name.textContent = card.zh || "未命名";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "category-batch-card-delete";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      deleteCategoryBatchCard(card.id);
    });

    item.append(imageWrap, name, deleteButton);
    return item;
  }

  async function deleteCategoryBatchCard(cardId) {
    const card = getCardById(cardId);
    if (!card) return;

    const confirmed = await showConfirmDialog(`确定删除卡片“${card.zh || card.prompt || "未命名"}”吗？该卡片也会从所有卡组中移除。`, {
      okText: "删除"
    });
    if (!confirmed) return;

    removeLibraryCardsByIds([cardId]);
    renderLibrary();
    refreshOutputPoolsAndLibrary();
    renderCategoryBatchDialog();
  }

  async function deleteCategoryBatchTagGroup(tag) {
    const categoryId = categoryBatchDialogCategoryId;
    if (!categoryId) return;
    const category = getCategoryById(categoryId);

    const matchedCards = getCategoryCardsForBatch(categoryId).filter(card => {
      const tags = getCardTags(card);
      return tag === "无标签" ? tags.length === 0 : tags.includes(tag);
    });

    if (matchedCards.length === 0) return;

    const confirmed = await showConfirmDialog(
      `确定删除分类“${category?.name || "当前分类"}”中标签“${tag}”下的 ${matchedCards.length} 张卡片吗？`,
      {
        okText: "删除全部"
      }
    );
    if (!confirmed) return;

    removeLibraryCardsByIds(matchedCards.map(card => card.id));
    renderLibrary();
    refreshOutputPoolsAndLibrary();
    renderCategoryBatchDialog();
  }

  function cloneOutputPoolForPreset(pool) {
    const cardIds = Array.isArray(pool?.cardIds) ? Array.from(new Set(pool.cardIds)) : [];
    const cardWeights = {};
    const cardStrengths = {};

    cardIds.forEach(cardId => {
      cardWeights[cardId] = clampPoolCardWeight(pool?.cardWeights?.[cardId] ?? 1);
      cardStrengths[cardId] = clampPromptStrength(pool?.cardStrengths?.[cardId] ?? getCardById(cardId)?.strength ?? 1);
    });

    return {
      id: pool?.id || createId("pool"),
      name: normalizeOutputPoolNameLabel(pool?.name, "未命名卡组"),
      mode: ["fixed", "random", "sequence", "all", "off"].includes(pool?.mode) ? pool.mode : "random",
      target: ["positive", "negative"].includes(pool?.target) ? pool.target : "positive",
      lockRole: "",
      cardIds,
      cardWeights,
      cardStrengths
    };
  }

  function normalizeOutputPoolNameLabel(name, fallback = "未命名卡组") {
    const text = String(name || "").trim();
    if (!text) return fallback;
    if (text === "正向固定输出池") return "正向固定卡组";

    const legacyAddPoolMatch = text.match(/^添加池(\d+)$/);
    if (legacyAddPoolMatch) {
      return `添加卡组${legacyAddPoolMatch[1]}`;
    }

    return text;
  }

  function collectPoolGenerationSettings() {
    return {
      width: getInputValue("forgeWidth", "1024"),
      height: getInputValue("forgeHeight", "1536"),
      seed: getInputValue("forgeSeed", "-1"),
      taskCount: getInputValue("taskCount", "1"),
      hiresFix: getCheckboxValue("forgeHiresFix", false),
      adetailer: getCheckboxValue("forgeADetailer", false)
    };
  }

  function applyPoolGenerationSettings(generation) {
    if (!generation || typeof generation !== "object") return;

    setInputValue("forgeWidth", generation.width ?? "1024");
    setInputValue("forgeHeight", generation.height ?? "1536");
    setInputValue("forgeSeed", generation.seed ?? "-1");
    setInputValue("taskCount", generation.taskCount ?? "1");
    setCheckboxValue("forgeHiresFix", generation.hiresFix ?? false);
    setCheckboxValue("forgeADetailer", generation.adetailer ?? false);
  }

  function getPoolPresetPreviewImageCount(presetOrPools) {
    const sourcePools = Array.isArray(presetOrPools)
      ? presetOrPools
      : presetOrPools?.outputPools;
    const counts = (Array.isArray(sourcePools) ? sourcePools : [])
      .filter(pool => ["sequence", "random"].includes(pool?.mode))
      .map(pool => Array.isArray(pool.cardIds) ? pool.cardIds.length : 0)
      .filter(count => count > 0);

    return counts.length > 0 ? Math.max(...counts) : 0;
  }

  function normalizePoolPresetPreviewImage(image) {
    if (!image || typeof image !== "object") return null;
    const relativePath = typeof image.relativePath === "string" ? image.relativePath : "";
    const src = typeof image.src === "string" && image.src
      ? image.src
      : normalizePreviewImageSrc(relativePath);
    const filePath = typeof image.filePath === "string" ? image.filePath : "";
    if (!src && !filePath && !relativePath) return null;

    return {
      src,
      filePath,
      relativePath,
      label: typeof image.label === "string" ? image.label : "生成图片",
      meta: image.meta || null
    };
  }

  function collectPoolPresetPreviewImages(sourceImages, limit) {
    const count = Math.max(0, Math.floor(Number(limit) || 0));
    const normalizedImages = (Array.isArray(sourceImages) ? sourceImages : [])
      .filter(Boolean)
      .map(normalizePoolPresetPreviewImage)
      .filter(Boolean);

    return count > 0 ? normalizedImages.slice(0, count) : normalizedImages;
  }

  function getPoolPresetPreviewSourceImages(preset = null) {
    const currentImages = currentForgeImages.filter(Boolean);
    if (currentImages.length > 0) {
      return currentImages;
    }

    const expectedCount = getPoolPresetPreviewImageCount(preset);
    const historyImages = generationHistory.slice(0, HISTORY_LIMIT).filter(Boolean);
    return expectedCount > 0 ? historyImages.slice(0, expectedCount) : historyImages;
  }

  function collectCurrentPoolPresetPreviewImages(preset = null) {
    const sourceImages = getPoolPresetPreviewSourceImages(preset);
    return collectPoolPresetPreviewImages(sourceImages, sourceImages.length);
  }

  function getPoolPresetPreviewFolder(categoryName, presetName) {
    return [
      "cards settings",
      categoryName || "默认",
      presetName || "未命名卡组预设"
    ].join("/");
  }

  async function copyPoolPresetPreviewImagesToFolder(preset, categoryName) {
    const previewImages = collectCurrentPoolPresetPreviewImages(preset);
    if (previewImages.length === 0) return [];

    if (!window.localApp?.copyPreviewImage) {
      throw new Error("当前环境无法复制卡组预设预览图。");
    }

    const previewFolder = getPoolPresetPreviewFolder(categoryName, preset.name);
    const copiedImages = [];

    for (let index = 0; index < previewImages.length; index += 1) {
      const image = previewImages[index];
      const copied = await window.localApp.copyPreviewImage({
        sourceFilePath: image.filePath || "",
        src: image.src || "",
        previewName: `${preset.name}-${String(index + 1).padStart(2, "0")}`,
        previewFolder
      });
      const relativePath = copied?.relativePath || "";

      if (!relativePath) {
        throw new Error("没有返回可用的卡组预设预览图路径。");
      }

      copiedImages.push(normalizePoolPresetPreviewImage({
        ...image,
        src: normalizePreviewImageSrc(relativePath),
        filePath: "",
        relativePath,
        label: image.label || `${preset.name}-${index + 1}`
      }));
    }

    return copiedImages.filter(Boolean);
  }

  function normalizePoolPresetCategories() {
    if (!Array.isArray(poolPresetCategories) || poolPresetCategories.length === 0) {
      poolPresetCategories = [{ id: "pool_preset_default", name: "默认" }];
    }

    const seen = new Set();
    poolPresetCategories = poolPresetCategories
      .map(category => ({
        id: category.id || createId("pool_preset_cat"),
        name: category.name || "未命名分类"
      }))
      .filter(category => {
        if (seen.has(category.id)) return false;
        seen.add(category.id);
        return true;
      });

    if (!poolPresetCategories.some(category => category.id === activePoolPresetCategoryId)) {
      activePoolPresetCategoryId = poolPresetCategories[0].id;
    }
  }

  function normalizePoolPreset(preset) {
    if (!preset || typeof preset !== "object") return null;

    return {
      id: preset.id || createId("pool_preset"),
      categoryId: preset.categoryId || activePoolPresetCategoryId || "pool_preset_default",
      name: preset.name || "未命名卡组预设",
      createdAt: preset.createdAt || new Date().toISOString(),
      updatedAt: preset.updatedAt || preset.createdAt || new Date().toISOString(),
      outputPools: Array.isArray(preset.outputPools)
        ? preset.outputPools.map(cloneOutputPoolForPreset)
        : [],
      generation: preset.generation && typeof preset.generation === "object"
        ? {
          width: preset.generation.width ?? "1024",
          height: preset.generation.height ?? "1536",
          seed: preset.generation.seed ?? "-1",
          taskCount: preset.generation.taskCount ?? "1",
          hiresFix: Boolean(preset.generation.hiresFix),
          adetailer: Boolean(preset.generation.adetailer)
        }
        : collectPoolGenerationSettings(),
      previewImages: Array.isArray(preset.previewImages)
        ? preset.previewImages.map(normalizePoolPresetPreviewImage).filter(Boolean)
        : []
    };
  }

  function normalizePoolPresetData() {
    normalizePoolPresetCategories();
    const validCategoryIds = new Set(poolPresetCategories.map(category => category.id));
    poolPresets = (Array.isArray(poolPresets) ? poolPresets : [])
      .map(normalizePoolPreset)
      .filter(Boolean)
      .map(preset => ({
        ...preset,
        categoryId: validCategoryIds.has(preset.categoryId) ? preset.categoryId : activePoolPresetCategoryId
      }));

    if (selectedPoolPresetId && !poolPresets.some(preset => preset.id === selectedPoolPresetId)) {
      selectedPoolPresetId = "";
    }
  }

  function getActivePoolPresetCategory() {
    normalizePoolPresetData();
    return poolPresetCategories.find(category => category.id === activePoolPresetCategoryId) || poolPresetCategories[0];
  }

  function getSelectedPoolPreset() {
    normalizePoolPresetData();
    return poolPresets.find(preset => preset.id === selectedPoolPresetId) || null;
  }

  function createPoolPresetFromCurrent(name, categoryId = activePoolPresetCategoryId) {
    normalizeOutputPools();
    const outputPoolCopies = outputPools.map(cloneOutputPoolForPreset);
    const now = new Date().toISOString();

    const presetDraft = {
      id: createId("pool_preset"),
      categoryId,
      name,
      createdAt: now,
      updatedAt: now,
      outputPools: outputPoolCopies,
      generation: collectPoolGenerationSettings(),
      previewImages: []
    };
    presetDraft.previewImages = collectCurrentPoolPresetPreviewImages(presetDraft);

    return normalizePoolPreset(presetDraft);
  }

  function openPoolPresetPage() {
    const dialog = document.getElementById("poolPresetDialog");
    if (!dialog) return;

    clearCustomDrag();
    normalizePoolPresetData();
    dialog.classList.remove("hidden");
    dialog.setAttribute("aria-hidden", "false");
    renderPoolPresetPage();
    if (onboardingGuideState.active && onboardingGuideState.step === 15) {
      setOnboardingStep(16);
    } else {
      scheduleOnboardingPlacement();
    }
  }

  function closePoolPresetPage() {
    const dialog = document.getElementById("poolPresetDialog");
    if (dialog) {
      dialog.classList.add("hidden");
      dialog.setAttribute("aria-hidden", "true");
    }
    releaseModalFocus();
    scheduleOnboardingPlacement();
  }

  function renderPoolPresetPage() {
    normalizePoolPresetData();
    renderPoolPresetCategories();
    renderPoolPresetList();

    const summary = document.getElementById("poolPresetSummary");
    if (summary) {
      const activeCategory = getActivePoolPresetCategory();
      const count = poolPresets.filter(preset => preset.categoryId === activeCategory.id).length;
      summary.textContent = `${activeCategory.name} · ${count} 个预设`;
    }
    scheduleOnboardingPlacement();
  }

  function renderPoolPresetCategories() {
    const list = document.getElementById("poolPresetCategoryList");
    if (!list) return;

    list.replaceChildren();
    poolPresetCategories.forEach(category => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pool-preset-category-button";
      button.classList.toggle("active", category.id === activePoolPresetCategoryId);
      button.textContent = category.name;
      button.addEventListener("click", () => {
        activePoolPresetCategoryId = category.id;
        selectedPoolPresetId = "";
        renderPoolPresetPage();
      });
      list.appendChild(button);
    });
  }

  function renderPoolPresetList() {
    const list = document.getElementById("poolPresetList");
    if (!list) return;

    const activeCategory = getActivePoolPresetCategory();
    const presets = poolPresets
      .filter(preset => preset.categoryId === activeCategory.id)
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));

    list.replaceChildren();

    if (presets.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pool-preset-empty";
      empty.textContent = "当前分类暂无卡组预设。";
      list.appendChild(empty);
      return;
    }

    presets.forEach(preset => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "pool-preset-card";
      card.classList.toggle("active", preset.id === selectedPoolPresetId);

      const info = document.createElement("div");
      info.className = "pool-preset-card-info";

      const title = document.createElement("div");
      title.className = "pool-preset-card-title";
      title.textContent = preset.name;

      const meta = document.createElement("div");
      meta.className = "pool-preset-card-meta";
      const poolCount = Array.isArray(preset.outputPools) ? preset.outputPools.length : 0;
      const cardCount = (preset.outputPools || []).reduce((sum, pool) => sum + (Array.isArray(pool.cardIds) ? pool.cardIds.length : 0), 0);

      const previewStrip = document.createElement("div");
      previewStrip.className = "pool-preset-preview-strip";
      const expectedPreviewCount = getPoolPresetPreviewImageCount(preset);
      const previewImages = Array.isArray(preset.previewImages)
        ? preset.previewImages.map(normalizePoolPresetPreviewImage).filter(Boolean)
        : [];
      const displayedPreviewImages = previewImages.slice(0, 5);

      if (previewImages.length === 0) {
        const emptyPreview = document.createElement("div");
        emptyPreview.className = "pool-preset-preview-empty";
        emptyPreview.textContent = expectedPreviewCount ? `需${expectedPreviewCount}张` : "无图组";
        previewStrip.appendChild(emptyPreview);
      } else {
        displayedPreviewImages.forEach((previewImage, previewIndex) => {
          const wrap = document.createElement("div");
          wrap.className = "pool-preset-preview-image";
          const imageSrc = normalizePreviewImageSrc(previewImage.relativePath || "") ||
            previewImage.src ||
            normalizePreviewImageSrc(previewImage.filePath || "");

          if (imageSrc) {
            const image = document.createElement("img");
            image.draggable = false;
            image.alt = previewImage.label || "预览图";
            attachRetryingImage(image, imageSrc, {
              fallback: () => {
                wrap.textContent = "无图";
              }
            });
            wrap.appendChild(image);
          } else {
            wrap.textContent = "无图";
          }

          previewStrip.appendChild(wrap);
          wrap.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            openImageViewer(previewImage, previewImages, previewIndex);
          });
        });
      }

      meta.textContent = `${poolCount} 个卡组 · ${cardCount} 张卡 · 图组 ${previewImages.length}/${expectedPreviewCount || 0} · ${formatDateTimeText(preset.updatedAt)}`;
      info.append(title, meta);

      card.append(info, previewStrip);
      card.addEventListener("click", () => {
        selectedPoolPresetId = preset.id;
        renderPoolPresetPage();
      });
      card.addEventListener("dblclick", () => loadSelectedPoolPreset());
      list.appendChild(card);
    });
  }

  function formatDateTimeText(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  async function addPoolPresetCategory() {
    const name = await showPromptDialog("请输入卡组预设分类名称：", "新分类");
    const nextName = String(name || "").trim();
    if (!nextName) return;

    const category = { id: createId("pool_preset_cat"), name: nextName };
    poolPresetCategories.push(category);
    activePoolPresetCategoryId = category.id;
    selectedPoolPresetId = "";
    renderPoolPresetPage();
  }

  async function renamePoolPresetCategory() {
    const category = getActivePoolPresetCategory();
    if (!category) return;

    const name = await showPromptDialog("请输入新的卡组预设分类名称：", category.name);
    const nextName = String(name || "").trim();
    if (!nextName) return;

    category.name = nextName;
    renderPoolPresetPage();
  }

  async function deletePoolPresetCategory() {
    const category = getActivePoolPresetCategory();
    if (!category || poolPresetCategories.length <= 1) {
      alert("至少保留一个卡组预设分类。");
      return;
    }

    const presetCount = poolPresets.filter(preset => preset.categoryId === category.id).length;
    const confirmed = await showConfirmDialog(`确定删除卡组预设分类“${category.name}”吗？其中 ${presetCount} 个预设会移动到其他分类。`);
    if (!confirmed) return;

    const fallback = poolPresetCategories.find(item => item.id !== category.id);
    poolPresets.forEach(preset => {
      if (preset.categoryId === category.id) {
        preset.categoryId = fallback.id;
      }
    });
    poolPresetCategories = poolPresetCategories.filter(item => item.id !== category.id);
    activePoolPresetCategoryId = fallback.id;
    selectedPoolPresetId = "";
    renderPoolPresetPage();
  }

  async function saveCurrentPoolPreset() {
    const category = getActivePoolPresetCategory();
    const name = await showPromptDialog("请输入卡组预设名称：", "新卡组预设");
    const nextName = String(name || "").trim();
    if (!nextName || !category) return;

    const preset = createPoolPresetFromCurrent(nextName, category.id);
    try {
      const copiedPreviewImages = await copyPoolPresetPreviewImagesToFolder(preset, category.name);
      if (copiedPreviewImages.length > 0) {
        preset.previewImages = copiedPreviewImages;
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      return;
    }

    poolPresets.push(preset);
    selectedPoolPresetId = preset.id;
    renderPoolPresetPage();

    if (onboardingGuideState.active && onboardingGuideState.step >= 16) {
      completeOnboardingGuide("启动向导已完成，卡组预设已保存。");
    }
  }

  function getMissingPresetCardCount(preset) {
    const validCardIds = new Set(cards.map(card => card.id));
    return (preset?.outputPools || []).reduce((sum, pool) => (
      sum + (Array.isArray(pool.cardIds) ? pool.cardIds.filter(cardId => !validCardIds.has(cardId)).length : 0)
    ), 0);
  }

  async function loadSelectedPoolPreset() {
    const preset = getSelectedPoolPreset();
    if (!preset) {
      alert("请先选择一个卡组预设。");
      return;
    }

    const missingCount = getMissingPresetCardCount(preset);
    const confirmed = await showConfirmDialog(
      `读取卡组预设“${preset.name}”会替换当前卡组。${missingCount ? `将跳过 ${missingCount} 张已删除卡片。` : ""}确定继续吗？`,
      { okText: "读取" }
    );
    if (!confirmed) return;

    const validCardIds = new Set(cards.map(card => card.id));
    outputPools = (preset.outputPools || []).map(cloneOutputPoolForPreset).map(pool => ({
      ...pool,
      cardIds: pool.cardIds.filter(cardId => validCardIds.has(cardId))
    }));
    outputPools.forEach(pool => {
      normalizePoolWeights(pool);
      normalizePoolStrengths(pool);
    });
    normalizeOutputPools();
    expandedOutputPoolId = "";
    applyPoolGenerationSettings(preset.generation);
    refreshOutputPoolsAndLibrary();
    renderPoolPresetPage();
  }

  async function overwriteSelectedPoolPreset() {
    const preset = getSelectedPoolPreset();
    if (!preset) {
      alert("请先选择一个卡组预设。");
      return;
    }

    const confirmed = await showConfirmDialog(`确定用当前卡组覆盖卡组预设“${preset.name}”吗？`, {
      okText: "覆盖"
    });
    if (!confirmed) return;

    const nextPreset = createPoolPresetFromCurrent(preset.name, preset.categoryId);
    let copiedPreviewImages = [];

    try {
      const category = poolPresetCategories.find(item => item.id === preset.categoryId);
      copiedPreviewImages = await copyPoolPresetPreviewImagesToFolder(nextPreset, category?.name || "");
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      return;
    }

    Object.assign(preset, {
      outputPools: nextPreset.outputPools,
      generation: nextPreset.generation,
      previewImages: copiedPreviewImages.length > 0 ? copiedPreviewImages : preset.previewImages,
      updatedAt: new Date().toISOString()
    });
    renderPoolPresetPage();
  }

  async function deleteSelectedPoolPreset() {
    const preset = getSelectedPoolPreset();
    if (!preset) {
      alert("请先选择一个卡组预设。");
      return;
    }

    const confirmed = await showConfirmDialog(`确定删除卡组预设“${preset.name}”吗？`);
    if (!confirmed) return;

    poolPresets = poolPresets.filter(item => item.id !== preset.id);
    selectedPoolPresetId = "";
    renderPoolPresetPage();
  }

  async function renameSelectedPoolPreset() {
    const preset = getSelectedPoolPreset();
    if (!preset) {
      alert("请先选择一个卡组预设。");
      return;
    }

    const name = await showPromptDialog("请输入新的卡组预设名称：", preset.name);
    const nextName = String(name || "").trim();
    if (!nextName) return;

    preset.name = nextName;
    preset.updatedAt = new Date().toISOString();
    renderPoolPresetPage();
  }

  function addOutputPool() {
    normalizeOutputPools();
    const nextSequenceIndex = outputPools.filter(pool => !isLockedOutputPool(pool)).length + 1;

    outputPools.splice(outputPools.length, 0, {
      id: createId("pool"),
      name: `添加卡组${nextSequenceIndex}`,
      mode: "sequence",
      target: "positive",
      lockRole: "",
      cardIds: [],
      cardWeights: {},
      cardStrengths: {}
    });

    normalizeOutputPools();
    refreshOutputPoolsAndLibrary();
  }

  function createLockedOutputPool(_lockRole, cardIds = []) {
    return {
      id: createId("pool"),
      name: "正向固定卡组",
      mode: "fixed",
      target: "positive",
      lockRole: "",
      cardIds,
      cardStrengths: {}
    };
  }

  function getNormalizedMiddlePoolName(pool, index) {
    const autoName = `添加卡组${index + 1}`;
    const currentName = String(pool?.name || "").trim();
    const autoNamePrefix = ["添加卡组", "添加池"].find(prefix => currentName.startsWith(prefix)) || "";
    const autoNameIndex = autoNamePrefix ? Number(currentName.slice(autoNamePrefix.length)) : NaN;

    if (!currentName || (
      autoNamePrefix &&
      Number.isInteger(autoNameIndex) &&
      autoNameIndex > 0
    )) {
      return autoName;
    }

    return currentName;
  }

  function isPositiveFixedPool(pool) {
    return false;
  }

  function isNegativeFixedPool(pool) {
    return pool?.lockRole === "negativeFixed" || (pool?.mode === "fixed" && pool?.target === "negative");
  }

  function isLockedOutputPool(pool) {
    return false;
  }

  function clampPoolCardWeight(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return 1;
    }

    return Math.max(0, Math.min(999, number));
  }

  function normalizePoolWeights(pool) {
    if (!pool) return;

    const nextWeights = {};
    const sourceWeights = pool.cardWeights && typeof pool.cardWeights === "object" ? pool.cardWeights : {};

    if (Array.isArray(pool.cardIds)) {
      pool.cardIds.forEach(cardId => {
        nextWeights[cardId] = clampPoolCardWeight(sourceWeights[cardId] ?? 1);
      });
    }

    pool.cardWeights = nextWeights;
  }

  function normalizePoolStrengths(pool) {
    if (!pool) return;

    const nextStrengths = {};
    const sourceStrengths = pool.cardStrengths && typeof pool.cardStrengths === "object" ? pool.cardStrengths : {};

    if (Array.isArray(pool.cardIds)) {
      pool.cardIds.forEach(cardId => {
        const card = getCardById(cardId);
        nextStrengths[cardId] = clampPromptStrength(sourceStrengths[cardId] ?? card?.strength ?? 1);
      });
    }

    pool.cardStrengths = nextStrengths;
  }

  function getPoolCardStrength(pool, cardId) {
    return clampPromptStrength(pool?.cardStrengths?.[cardId] ?? getCardById(cardId)?.strength ?? 1);
  }

  function getCardLibrarySortRank(cardId, fallbackIndex = 0) {
    const card = getCardById(cardId);
    const categoryIndex = card
      ? categories.findIndex(category => category.id === card.categoryId)
      : -1;
    const cardIndex = card
      ? cards.findIndex(item => item.id === card.id)
      : -1;

    return {
      categoryIndex: categoryIndex >= 0 ? categoryIndex : Number.MAX_SAFE_INTEGER,
      cardIndex: cardIndex >= 0 ? cardIndex : Number.MAX_SAFE_INTEGER,
      fallbackIndex
    };
  }

  function compareCardsByLibraryOrder(left, right) {
    const leftRank = getCardLibrarySortRank(left.cardId, left.index);
    const rightRank = getCardLibrarySortRank(right.cardId, right.index);

    return leftRank.categoryIndex - rightRank.categoryIndex ||
      leftRank.cardIndex - rightRank.cardIndex ||
      leftRank.fallbackIndex - rightRank.fallbackIndex;
  }

  function autoSortOutputPools() {
    normalizeOutputPools();

    outputPools.forEach(pool => {
      pool.cardIds = (Array.isArray(pool.cardIds) ? pool.cardIds : [])
        .map((cardId, index) => ({ cardId, index }))
        .sort(compareCardsByLibraryOrder)
        .map(item => item.cardId);

      normalizePoolWeights(pool);
      normalizePoolStrengths(pool);
    });

    refreshOutputPoolsAndLibrary();
  }

  function normalizeOutputPools() {
    const pools = Array.isArray(outputPools) ? outputPools : [];
    outputPools = pools
      .filter(pool => !isNegativeFixedPool(pool))
      .map((pool, index) => ({
        ...pool,
        name: getNormalizedMiddlePoolName(pool, index),
        mode: ["fixed", "random", "sequence", "all", "off"].includes(pool.mode) ? pool.mode : "random",
        target: "positive",
        lockRole: "",
        cardIds: Array.isArray(pool.cardIds) ? pool.cardIds : [],
        cardWeights: pool.cardWeights && typeof pool.cardWeights === "object" ? pool.cardWeights : {},
        cardStrengths: pool.cardStrengths && typeof pool.cardStrengths === "object" ? pool.cardStrengths : {}
      }));

    outputPools.forEach(pool => {
      normalizePoolWeights(pool);
      normalizePoolStrengths(pool);
    });

    if (expandedOutputPoolId && !outputPools.some(pool => pool.id === expandedOutputPoolId)) {
      expandedOutputPoolId = "";
    }
  }

  function renderOutputPools() {
    const container = document.getElementById("outputPoolsContainer");
    normalizeOutputPools();
    container.innerHTML = "";

    outputPools.forEach(pool => {
      const div = document.createElement("div");

      const targetClass = pool.target === "negative" ? "negative-target" : "positive-target";
      const isExpanded = pool.id === expandedOutputPoolId;
      const validCards = pool.cardIds
        .map(cardId => getCardById(cardId))
        .filter(card => card);
      const cardCountText = `${validCards.length} 张卡片`;
      div.className = `output-pool ${pool.mode} ${targetClass} ${isExpanded ? "expanded" : "collapsed"}`;
      div.dataset.poolId = pool.id;
      div.dataset.poolName = pool.name || "";
      div.dataset.poolMode = pool.mode || "";

      const lockedPool = isLockedOutputPool(pool);
      const deleteButton = `<button type="button" onclick="deleteOutputPool('${pool.id}')">删除</button>`;
      const modeButton = !lockedPool
        ? `<button class="pool-mode-toggle-button" type="button"><span class="pool-mode-label">模式</span><span class="pool-mode-value">${escapeHtml(modeToChinese(pool.mode))}</span></button>`
        : "";
      const actionButtons = isExpanded
        ? `
          <button type="button" onclick="renameOutputPool('${pool.id}')">重命名</button>
          <button type="button" onclick="clearOutputPool('${pool.id}')">清空</button>
          ${deleteButton}
        `
        : modeButton;

      div.innerHTML = `
        <div class="pool-top">
          <div class="pool-expand-handle" title="${lockedPool ? "锁定卡组不可排序" : "拖动调整卡组顺序"}" aria-hidden="true"></div>
          <div>
            <div class="pool-title">${escapeHtml(pool.name)}</div>
            <div class="pool-meta">${escapeHtml(isExpanded ? `${targetToChinese(pool.target)} / ${modeToChinese(pool.mode)} / ${cardCountText}` : cardCountText)}</div>
          </div>
          <div class="pool-actions">${actionButtons}</div>
        </div>

        ${isExpanded ? `<div class="pool-dropzone"></div>` : ""}
      `;

      const poolTop = div.querySelector(".pool-top");
      poolTop?.addEventListener("click", event => {
        if (event.target.closest("button, input, select, textarea, label")) return;

        toggleOutputPoolExpanded(pool.id);
      });

      const expandHandle = div.querySelector(".pool-expand-handle");
      expandHandle?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
      });
      expandHandle?.addEventListener("mousedown", event => {
        event.stopPropagation();

        if (lockedPool) return;

        startCustomDrag(event, {
          type: "output-pool-order",
          poolId: pool.id
        }, div);
      });

      const actions = div.querySelector(".pool-actions");
      if (actions) {
        actions.addEventListener("click", event => event.stopPropagation());
        actions.addEventListener("mousedown", event => event.stopPropagation());
        const modeToggleButton = actions.querySelector(".pool-mode-toggle-button");
        if (modeToggleButton) {
          modeToggleButton.title = "点击切换：随机 / 顺序 / 全选";
          modeToggleButton.addEventListener("click", () => cyclePoolMode(pool.id));
        }
      }

      div.addEventListener("dragover", handleOutputPoolCategoryDragOver);
      div.addEventListener("dragleave", handleOutputPoolCategoryDragLeave);
      div.addEventListener("drop", handleOutputPoolCategoryDrop);

      if (!lockedPool) {
        div.title = "点击展开卡组；拖动左侧把手可调整顺序";
      }

      const dropzone = div.querySelector(".pool-dropzone");
      if (dropzone) {
        if (validCards.length === 0) {
          const empty = document.createElement("div");
          empty.className = "pool-empty";
          empty.textContent = "把左侧卡片拖到这里";
          dropzone.appendChild(empty);
        } else {
          validCards.forEach(card => {
            dropzone.appendChild(createPoolCardElement(pool.id, card));
          });
        }
      }

      container.appendChild(div);
    });
    scheduleOnboardingPlacement();
  }

  function createPoolCardElement(poolId, card) {
    const pool = outputPools.find(item => item.id === poolId);
    const showWeight = pool?.mode === "random";
    const weight = showWeight ? clampPoolCardWeight(pool.cardWeights?.[card.id] ?? 1) : 1;
    const strength = getPoolCardStrength(pool, card.id);
    const strengthLocked = hasLockedEmbeddedStrength(card.prompt);
    const div = document.createElement("div");
    div.className = "pool-card";
    div.classList.toggle("embedded-strength-locked", strengthLocked);
    div.dataset.poolId = poolId;
    div.dataset.cardId = card.id;
    const imageSrc = getCardPreviewDisplaySrc(card);
    const strengthInputHtml = strengthLocked
      ? `<input type="text" value="内置" disabled>`
      : `<input type="number" min="-2" max="2" step="0.05" value="${formatPromptStrength(strength)}" oninput="setPoolCardStrength('${poolId}', '${card.id}', this.value)" onchange="this.value = formatPromptStrength(getPoolCardStrengthById('${poolId}', '${card.id}'))">`;

    div.innerHTML = `
      <div class="pool-card-image-slot"><div class="pool-card-noimage">无图</div></div>
      <div class="pool-card-main">
        <div class="pool-card-title">${escapeHtml(card.zh || "未命名")}</div>
        <div class="pool-card-prompt">${escapeHtml(card.prompt)}</div>
        <div class="pool-card-controls">
          ${showWeight ? `
            <label class="pool-card-weight">
              <span>权重</span>
              <input type="number" min="0" max="999" step="0.1" value="${escapeHtml(weight)}" oninput="setPoolCardWeight('${poolId}', '${card.id}', this.value)">
            </label>
          ` : ""}
          <label class="pool-card-strength${strengthLocked ? " is-locked" : ""}" title="${strengthLocked ? "卡片内强度优先" : ""}">
            <span>强度</span>
            ${strengthInputHtml}
          </label>
        </div>
      </div>
      <button class="remove-btn" title="移除" onclick="removeCardFromPool('${poolId}', '${card.id}')">×</button>
    `;

    const imageSlot = div.querySelector(".pool-card-image-slot");
    if (imageSlot && imageSrc) {
      imageSlot.replaceChildren();
      const image = document.createElement("img");
      image.draggable = false;
      image.alt = card.zh || "预览图";
      attachRetryingImage(image, imageSrc, {
        fallback: () => {
          const empty = document.createElement("div");
          empty.className = "pool-card-noimage";
          empty.textContent = "无图";
          imageSlot.replaceChildren(empty);
        }
      });
      imageSlot.appendChild(image);
    }

    div.addEventListener("mousedown", event => {
      startCustomDrag(event, {
        type: "pool-card",
        sourcePoolId: poolId,
        cardId: card.id
      }, div);
    });

    return div;
  }

  function refreshOutputPoolsAndLibrary() {
    renderOutputPools();
    renderLibrary();
    if (categoryBatchDialogCategoryId) {
      renderCategoryBatchDialog();
    }
    generatePrompt();
  }

  function addCardToPool(poolId, cardId) {
    addOrMoveCardInPool(poolId, cardId, null, true);
    refreshOutputPoolsAndLibrary();
  }

  function addOrMoveCardInPool(poolId, cardId, targetCardId, insertAfter) {
    const pool = outputPools.find(item => item.id === poolId);
    const card = getCardById(cardId);

    if (!pool || !card) return;

    normalizePoolWeights(pool);
    normalizePoolStrengths(pool);
    const existingWeight = pool.cardWeights?.[cardId] ?? 1;
    const existingStrength = pool.cardStrengths?.[cardId] ?? card.strength ?? 1;
    const existingIndex = pool.cardIds.indexOf(cardId);

    if (existingIndex >= 0 && !targetCardId) {
      pool.cardWeights[cardId] = clampPoolCardWeight(existingWeight);
      pool.cardStrengths[cardId] = clampPromptStrength(existingStrength);
      return;
    }

    pool.cardIds = pool.cardIds.filter(id => id !== cardId);

    let insertIndex = pool.cardIds.length;

    if (targetCardId) {
      const targetIndex = pool.cardIds.findIndex(id => id === targetCardId);

      if (targetIndex >= 0) {
        insertIndex = insertAfter ? targetIndex + 1 : targetIndex;
      }
    }

    pool.cardIds.splice(insertIndex, 0, cardId);
    pool.cardWeights[cardId] = clampPoolCardWeight(existingWeight);
    pool.cardStrengths[cardId] = clampPromptStrength(existingStrength);
  }

  function addCategoryToPool(poolId, categoryId) {
    const pool = outputPools.find(item => item.id === poolId);
    const category = getCategoryById(categoryId);

    if (!pool || !category) return;

    const categoryCards = getVisibleCardsForCategoryPage(category.id);
    categoryCards.forEach(card => {
      addOrMoveCardInPool(pool.id, card.id, null, true);
    });

    refreshOutputPoolsAndLibrary();
  }

  function addCategoryGroupToPool(poolId, groupId) {
    const pool = outputPools.find(item => item.id === poolId);
    const group = getCategoryGroupById(groupId);

    if (!pool || !group) return;

    const activeCategory = getCategoryById(ensureActiveCategoryId());
    const targetCategory = activeCategory?.groupId === group.id
      ? activeCategory
      : getCategoriesInGroup(group.id)[0];

    if (!targetCategory) return;

    getVisibleCardsForCategoryPage(targetCategory.id).forEach(card => {
      addOrMoveCardInPool(pool.id, card.id, null, true);
    });

    refreshOutputPoolsAndLibrary();
  }

  function getCategoryIdForCopiedCard(target) {
    if (target === "negative" && getCategoryById("negative")) {
      return "negative";
    }

    if (target !== "negative" && getCategoryById("quality")) {
      return "quality";
    }

    if (getCategoryById("other")) {
      return "other";
    }

    return getFirstCategoryId();
  }

  function getCategoryIdFromSnapshot(snapshot) {
    if (snapshot?.categoryId && getCategoryById(snapshot.categoryId)) {
      return snapshot.categoryId;
    }

    if (snapshot?.categoryName) {
      const matchedCategory = categories.find(category => category.name === snapshot.categoryName);
      if (matchedCategory) {
        return matchedCategory.id;
      }
    }

    return getCategoryIdForCopiedCard(snapshot?.target);
  }

  function ensureCardFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return null;

    const prompt = String(snapshot.prompt || "").trim();
    const zh = String(snapshot.zh || "").trim();
    const existingById = snapshot.id ? getCardById(snapshot.id) : null;

    if (existingById) {
      return existingById;
    }

    const existingByContent = cards.find(card =>
      String(card.prompt || "").trim() === prompt &&
      String(card.zh || "").trim() === zh
    );

    if (existingByContent) {
      return existingByContent;
    }

    if (!prompt && !zh) return null;

    const card = {
      id: createId("card"),
      categoryId: getCategoryIdFromSnapshot(snapshot),
      zh: zh || prompt || "复制的提示词卡片",
      prompt,
      image: typeof snapshot.image === "string" ? snapshot.image : "",
      strength: 1,
      tags: "复制参数"
    };

    cards.push(card);
    return card;
  }

  function copySelectedCardsToOutputPools(selectedCards) {
    if (!Array.isArray(selectedCards) || selectedCards.length === 0) {
      return {
        copied: 0,
        skipped: 0,
        restored: 0
      };
    }

    normalizeOutputPools();

    let targetPositivePool = outputPools.find(pool => pool.target === "positive");
    if (!targetPositivePool) {
      targetPositivePool = {
        id: createId("pool"),
        name: "复制参数卡组",
        mode: "fixed",
        target: "positive",
        lockRole: "",
        cardIds: [],
        cardWeights: {},
        cardStrengths: {}
      };
      outputPools.push(targetPositivePool);
    }
    const positiveIds = [];
    const copiedStrengths = {};
    let skipped = 0;
    let restored = 0;

    selectedCards.forEach(snapshot => {
      const restoredSnapshot = snapshot?.target === "negative" && !/\bnegative\s*[:：]/i.test(String(snapshot?.prompt || ""))
        ? { ...snapshot, prompt: `negative: ${String(snapshot?.prompt || "").trim()}` }
        : snapshot;
      const existedBefore = Boolean(snapshot?.id && getCardById(snapshot.id));
      const card = ensureCardFromSnapshot(restoredSnapshot);
      if (!card) {
        skipped += 1;
        return;
      }
      if (snapshot?.target === "negative" && restoredSnapshot?.prompt && !/\bnegative\s*[:：]/i.test(String(card.prompt || ""))) {
        card.prompt = restoredSnapshot.prompt;
      }

      if (!existedBefore && snapshot?.id) {
        restored += 1;
      }

      if (!positiveIds.includes(card.id)) {
        positiveIds.push(card.id);
      }
      copiedStrengths[card.id] = clampPromptStrength(snapshot?.strength ?? card.strength ?? 1);
    });

    outputPools.forEach(pool => {
      pool.cardIds = [];
      pool.cardWeights = {};
      pool.cardStrengths = {};
    });

    if (targetPositivePool) {
      targetPositivePool.cardIds = positiveIds;
      targetPositivePool.cardWeights = {};
      targetPositivePool.cardStrengths = {};
      positiveIds.forEach(cardId => {
        targetPositivePool.cardStrengths[cardId] = copiedStrengths[cardId] ?? clampPromptStrength(getCardById(cardId)?.strength ?? 1);
      });
    }

    normalizeOutputPools();
    renderLibrary();
    renderOutputPools();
    generatePrompt();

    return {
      copied: positiveIds.length,
      skipped,
      restored
    };
  }

  function movePoolCard(sourcePoolId, targetPoolId, cardId, targetCardId, insertAfter) {
    const sourcePool = outputPools.find(item => item.id === sourcePoolId);
    const targetPool = outputPools.find(item => item.id === targetPoolId);

    if (!sourcePool || !targetPool) return;

    normalizePoolWeights(sourcePool);
    normalizePoolWeights(targetPool);
    normalizePoolStrengths(sourcePool);
    normalizePoolStrengths(targetPool);
    const movedWeight = sourcePool.cardWeights?.[cardId] ?? targetPool.cardWeights?.[cardId] ?? 1;
    const movedStrength = sourcePool.cardStrengths?.[cardId] ?? targetPool.cardStrengths?.[cardId] ?? getCardById(cardId)?.strength ?? 1;
    sourcePool.cardIds = sourcePool.cardIds.filter(id => id !== cardId);
    delete sourcePool.cardWeights[cardId];
    delete sourcePool.cardStrengths[cardId];
    targetPool.cardIds = targetPool.cardIds.filter(id => id !== cardId);

    let insertIndex = targetPool.cardIds.length;

    if (targetCardId) {
      const targetIndex = targetPool.cardIds.findIndex(id => id === targetCardId);

      if (targetIndex >= 0) {
        insertIndex = insertAfter ? targetIndex + 1 : targetIndex;
      }
    }

    targetPool.cardIds.splice(insertIndex, 0, cardId);
    targetPool.cardWeights[cardId] = clampPoolCardWeight(movedWeight);
    targetPool.cardStrengths[cardId] = clampPromptStrength(movedStrength);
  }

  async function addCardToPoolByPrompt(cardId) {
    if (outputPools.length === 0) {
      alert("请先新增一个卡组。");
      return;
    }

    const list = outputPools
      .map((pool, index) => `${index + 1}. ${pool.name}（${targetToChinese(pool.target)} / ${modeToChinese(pool.mode)}）`)
      .join("\n");

    const answer = await showPromptDialog(`加入哪个卡组？请输入序号：\n${list}`, "1");

    if (answer === null) return;

    const index = parseInt(answer, 10) - 1;

    if (!outputPools[index]) {
      alert("卡组序号无效。");
      return;
    }

    addCardToPool(outputPools[index].id, cardId);
  }

  function removeCardFromPool(poolId, cardId) {
    const pool = outputPools.find(item => item.id === poolId);

    if (!pool) return;

    pool.cardIds = pool.cardIds.filter(id => id !== cardId);
    if (pool.cardWeights) {
      delete pool.cardWeights[cardId];
    }
    if (pool.cardStrengths) {
      delete pool.cardStrengths[cardId];
    }

    refreshOutputPoolsAndLibrary();
  }

  function setPoolCardWeight(poolId, cardId, value) {
    const pool = outputPools.find(item => item.id === poolId);

    if (!pool || pool.mode !== "random") return;

    normalizePoolWeights(pool);
    pool.cardWeights[cardId] = clampPoolCardWeight(value);
    generatePrompt();
  }

  function getPoolCardStrengthById(poolId, cardId) {
    const pool = outputPools.find(item => item.id === poolId);
    normalizePoolStrengths(pool);
    return getPoolCardStrength(pool, cardId);
  }

  function setPoolCardStrength(poolId, cardId, value) {
    const pool = outputPools.find(item => item.id === poolId);
    const card = getCardById(cardId);

    if (!pool || !pool.cardIds.includes(cardId)) return;
    if (hasLockedEmbeddedStrength(card?.prompt)) return;

    normalizePoolStrengths(pool);
    pool.cardStrengths[cardId] = clampPromptStrength(value);
    generatePrompt();
  }

  function clearOutputPool(poolId) {
    const pool = outputPools.find(item => item.id === poolId);

    if (!pool) return;

    pool.cardIds = [];
    pool.cardWeights = {};
    pool.cardStrengths = {};

    refreshOutputPoolsAndLibrary();
  }

  async function clearAllOutputPools() {
    const confirmed = await showConfirmDialog("确定清空全部卡组内容吗？不会删除卡片库卡片。", {
      okText: "清空"
    });
    if (!confirmed) return;

    outputPools.forEach(pool => {
      pool.cardIds = [];
      pool.cardWeights = {};
      pool.cardStrengths = {};
    });

    refreshOutputPoolsAndLibrary();
  }

  async function deleteOutputPool(poolId) {
    normalizeOutputPools();
    const pool = outputPools.find(item => item.id === poolId);

    if (!pool) return;
    if (isLockedOutputPool(pool)) return;

    const confirmed = await showConfirmDialog(`确定删除卡组“${pool.name}”吗？不会删除卡片库卡片。`);
    if (!confirmed) return;

    outputPools = outputPools.filter(item => item.id !== poolId);
    if (expandedOutputPoolId === poolId) {
      expandedOutputPoolId = "";
    }

    refreshOutputPoolsAndLibrary();
  }

  function setPoolName(poolId, name) {
    const pool = outputPools.find(item => item.id === poolId);

    if (!pool) return;

    pool.name = name.trim() || "未命名卡组";
    renderOutputPools();
    generatePrompt();
    releaseModalFocus();
    advanceOnboardingAfterPoolModeChange(pool.id);
  }

  async function renameOutputPool(poolId) {
    normalizeOutputPools();
    const pool = outputPools.find(item => item.id === poolId);

    if (!pool) return;

    const name = await showPromptDialog("请输入新的卡组名称：", pool.name || "");
    if (name === null) return;

    setPoolName(poolId, name);
  }

  function setPoolMode(poolId, mode) {
    normalizeOutputPools();
    const pool = outputPools.find(item => item.id === poolId);

    if (!pool) return;
    if (isLockedOutputPool(pool)) return;

    pool.mode = ["random", "sequence", "all"].includes(mode) ? mode : "random";

    renderOutputPools();
    generatePrompt();
    releaseModalFocus();
  }

  function cyclePoolMode(poolId) {
    normalizeOutputPools();
    const pool = outputPools.find(item => item.id === poolId);

    if (!pool || isLockedOutputPool(pool)) return;

    const modes = ["random", "sequence", "all"];
    const currentIndex = modes.indexOf(pool.mode);
    const nextMode = modes[(currentIndex + 1 + modes.length) % modes.length];
    setPoolMode(poolId, nextMode);
  }

  function setPoolTarget(poolId, target) {
    normalizeOutputPools();
    const pool = outputPools.find(item => item.id === poolId);

    if (!pool) return;
    if (isLockedOutputPool(pool)) return;

    pool.target = "positive";

    refreshOutputPoolsAndLibrary();
  }

  function moveOutputPool(poolId, direction) {
    normalizeOutputPools();
    const index = outputPools.findIndex(item => item.id === poolId);

    if (index < 0) return;

    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= outputPools.length) return;

    const temp = outputPools[index];
    outputPools[index] = outputPools[targetIndex];
    outputPools[targetIndex] = temp;

    refreshOutputPoolsAndLibrary();
  }

  function moveOutputPoolBeforeOrAfter(sourcePoolId, targetPoolId, insertAfter) {
    normalizeOutputPools();
    const sourceIndex = outputPools.findIndex(item => item.id === sourcePoolId);
    const targetIndex = outputPools.findIndex(item => item.id === targetPoolId);

    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

    const sourcePool = outputPools[sourceIndex];
    if (!sourcePool || isLockedOutputPool(sourcePool)) return;

    const [movedPool] = outputPools.splice(sourceIndex, 1);
    const nextTargetIndex = outputPools.findIndex(item => item.id === targetPoolId);
    if (nextTargetIndex < 0) {
      outputPools.splice(sourceIndex, 0, movedPool);
      return;
    }

    const safeInsertAfter = Boolean(insertAfter);
    const insertIndex = Math.max(
      0,
      Math.min(outputPools.length, nextTargetIndex + (safeInsertAfter ? 1 : 0))
    );

    outputPools.splice(insertIndex, 0, movedPool);
  }

  function modeToChinese(mode) {
    if (mode === "fixed") return "固定";
    if (mode === "random") return "随机";
    if (mode === "sequence") return "顺序";
    if (mode === "all") return "全选";
    if (mode === "off") return "不调用";
    return mode;
  }

  function targetToChinese(target) {
    if (target === "negative") return "负向";
    return "正向";
  }

  function randomPick(list) {
    if (!list || list.length === 0) return null;

    const index = Math.floor(Math.random() * list.length);
    return list[index];
  }

  function clampPromptStrength(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return 1;
    }

    return Math.min(2, Math.max(-2, number));
  }

  function formatPromptStrength(value) {
    return clampPromptStrength(value).toFixed(2).replace(/\.?0+$/, "");
  }

  function getCardStrength(card) {
    return clampPromptStrength(card?.strength ?? 1);
  }

  function splitCardPromptByNegativeMarker(prompt) {
    const sections = [];
    const pattern = /\b(negative|positive)\s*[:：]/gi;
    const text = String(prompt || "");
    let currentType = "positive";
    let cursor = 0;
    let match;

    while ((match = pattern.exec(text))) {
      const value = cleanPromptMarkerSegment(text.slice(cursor, match.index));
      if (value) {
        sections.push({ type: currentType, text: value });
      }

      currentType = match[1].toLowerCase() === "negative" ? "negative" : "positive";
      cursor = pattern.lastIndex;
    }

    const tail = cleanPromptMarkerSegment(text.slice(cursor));
    if (tail) {
      sections.push({ type: currentType, text: tail });
    }

    return sections;
  }

  function cleanPromptMarkerSegment(value) {
    let cleaned = String(value || "")
      .trim()
      .replace(/^[,，;；、\s]+|[,，;；、\s]+$/g, "");

    if (/^[()（）[\]【】{}《》,，;；、\s]+$/.test(cleaned)) {
      return "";
    }

    const pairs = [
      ["(", ")"],
      ["（", "）"],
      ["[", "]"],
      ["【", "】"],
      ["{", "}"],
      ["《", "》"]
    ];

    pairs.forEach(([open, close]) => {
      if (cleaned.startsWith(open) && !cleaned.includes(close)) {
        cleaned = cleaned.slice(open.length).trim();
      }
      if (cleaned.endsWith(open) && !cleaned.includes(close)) {
        cleaned = cleaned.slice(0, -open.length).trim();
      }
      if (cleaned.endsWith(close) && !cleaned.includes(open)) {
        cleaned = cleaned.slice(0, -close.length).trim();
      }
    });

    return cleaned.replace(/^[,，;；、\s]+|[,，;；、\s]+$/g, "");
  }

  function getCardPromptParts(card) {
    const sections = splitCardPromptByNegativeMarker(card?.prompt);

    return {
      positive: sections.filter(section => section.type !== "negative").map(section => section.text).join(", "),
      negative: sections.filter(section => section.type === "negative").map(section => section.text).join(", ")
    };
  }

  function withCardPrompt(card, prompt) {
    return {
      ...card,
      prompt
    };
  }

  function formatCardPrompt(card) {
    const prompt = String(card?.prompt || "").trim();
    if (!prompt) return "";

    if (hasLockedEmbeddedStrength(prompt)) {
      return prompt;
    }

    const strength = getCardStrength(card);

    if (hasAnglePrompt(prompt)) {
      return updateAnglePromptStrength(prompt, strength);
    }

    if (Math.abs(strength - 1) < 0.001) {
      return prompt;
    }

    return `(${prompt}:${formatPromptStrength(strength)})`;
  }

  function withPoolCardStrength(card, pool) {
    if (!card) return null;

    return {
      ...card,
      strength: getPoolCardStrength(pool, card.id)
    };
  }

  function weightedRandomPick(pool, list) {
    if (!list || list.length === 0) return null;
    if (!pool || pool.mode !== "random") return randomPick(list);

    normalizePoolWeights(pool);

    const weightedItems = list.map(card => ({
      card,
      weight: clampPoolCardWeight(pool.cardWeights?.[card.id] ?? 1)
    }));
    const totalWeight = weightedItems.reduce((sum, item) => sum + item.weight, 0);

    if (totalWeight <= 0) {
      return null;
    }

    let cursor = Math.random() * totalWeight;

    for (const item of weightedItems) {
      cursor -= item.weight;

      if (cursor <= 0) {
        return item.card;
      }
    }

    return weightedItems[weightedItems.length - 1].card;
  }

  function sequencePick(list, sequenceIndex = 0) {
    if (!list || list.length === 0) return null;

    const numericIndex = Number(sequenceIndex);
    const safeIndex = Number.isFinite(numericIndex) ? Math.trunc(numericIndex) : 0;
    const index = ((safeIndex % list.length) + list.length) % list.length;
    return list[index];
  }

  function buildPromptData(options = {}) {
    normalizeOutputPools();

    const positiveCards = [];
    const negativeCards = [];
    const sequenceIndex = Number.isFinite(Number(options.sequenceIndex))
      ? Number(options.sequenceIndex)
      : 0;
    const addSelectedCard = card => {
      if (!card) return;

      const parts = getCardPromptParts(card);

      if (parts.positive) {
        positiveCards.push(withCardPrompt(card, parts.positive));
      }

      if (parts.negative) {
        negativeCards.push(withCardPrompt(card, parts.negative));
      }
    };

    outputPools.forEach(pool => {
      if (pool.mode === "off") return;

      const poolCards = pool.cardIds
        .map(cardId => getCardById(cardId))
        .filter(card => card);

      if (pool.mode === "fixed") {
        poolCards.forEach(card => {
          addSelectedCard(withPoolCardStrength(card, pool));
        });
      }

      if (pool.mode === "random") {
        const randomCard = weightedRandomPick(pool, poolCards);

        if (randomCard) {
          addSelectedCard(withPoolCardStrength(randomCard, pool));
        }
      }

      if (pool.mode === "sequence") {
        const sequenceCard = sequencePick(poolCards, sequenceIndex);

        if (sequenceCard) {
          addSelectedCard(withPoolCardStrength(sequenceCard, pool));
        }
      }

      if (pool.mode === "all") {
        poolCards.forEach(card => {
          addSelectedCard(withPoolCardStrength(card, pool));
        });
      }
    });

    const positivePromptParts = removeDuplicateParts(
      positiveCards.map(formatCardPrompt)
    );

    const negativePromptParts = removeDuplicateParts(
      negativeCards.map(formatCardPrompt)
    );

    const negativeFromPools = negativePromptParts.join(", ");
    const finalNegative = negativeFromPools;

    return {
      positiveCards,
      negativeCards,
      positivePrompt: positivePromptParts.join(", "),
      negativeFromPools,
      finalNegative
    };
  }

  function removeDuplicateParts(parts) {
    const result = [];
    const seen = new Set();

    parts.forEach(part => {
      const cleaned = String(part || "").trim();
      const key = cleaned.toLowerCase();

      if (cleaned && !seen.has(key)) {
        seen.add(key);
        result.push(cleaned);
      }
    });

    return result;
  }

  function generatePrompt() {
    const data = buildPromptData();
    const promptOutput = document.getElementById("promptOutput");
    const negativeOutput = document.getElementById("negativeOutput");

    if (promptOutput) {
      promptOutput.value = data.positivePrompt;
    }

    if (negativeOutput) {
      negativeOutput.value = data.finalNegative;
    }

    return data;
  }

  function escapeForCommand(text) {
    return String(text || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, " ");
  }

  const DEFAULT_SCRIPT_STEPS = 20;
  const DEFAULT_SCRIPT_CFG_SCALE = 7;
  const DEFAULT_SCRIPT_SAMPLER = "Euler a";
  const DEFAULT_SCRIPT_SCHEDULER = "Automatic";
  const DEFAULT_SCRIPT_CLIP_SKIP = 2;

  function getDefaultNumber(source, key, fallback) {
    const number = Number(source?.[key]);
    return Number.isFinite(number) ? number : fallback;
  }

  function getDefaultString(source, key, fallback = "") {
    const value = source?.[key];
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  function getForgeTaskDefaults(source = currentForgeDefaults) {
    return {
      steps: getDefaultNumber(source, "steps", DEFAULT_SCRIPT_STEPS),
      cfgScale: getDefaultNumber(source, "cfgScale", DEFAULT_SCRIPT_CFG_SCALE),
      samplerName: getDefaultString(source, "samplerName", DEFAULT_SCRIPT_SAMPLER),
      scheduler: getDefaultString(source, "scheduler", DEFAULT_SCRIPT_SCHEDULER),
      clipSkip: getDefaultNumber(source, "clipSkip", DEFAULT_SCRIPT_CLIP_SKIP),
      hiresDenoisingStrength: getDefaultNumber(source, "hiresDenoisingStrength", 0.4),
      hiresScale: getDefaultNumber(source, "hiresScale", 1.5),
      hiresSteps: getDefaultNumber(source, "hiresSteps", DEFAULT_SCRIPT_STEPS),
      hiresUpscaler: getDefaultString(source, "hiresUpscaler", "R-ESRGAN 4x+ Anime6B"),
      hiresSamplerName: getDefaultString(source, "hiresSamplerName", ""),
      hiresScheduler: getDefaultString(source, "hiresScheduler", "")
    };
  }

  async function loadForgeTaskDefaults() {
    if (!window.forge?.getDefaults) {
      return getForgeTaskDefaults();
    }

    try {
      currentForgeDefaults = await window.forge.getDefaults();
    } catch {
      currentForgeDefaults = currentForgeDefaults || null;
    }

    return getForgeTaskDefaults();
  }

  function formatForgeTaskCommand(task) {
    const parts = [
      `--prompt "${escapeForCommand(task.prompt)}"`,
      `--negative_prompt "${escapeForCommand(task.negativePrompt)}"`,
      `--width ${task.width}`,
      `--height ${task.height}`,
      `--steps ${task.steps ?? DEFAULT_SCRIPT_STEPS}`,
      `--cfg_scale ${task.cfgScale ?? DEFAULT_SCRIPT_CFG_SCALE}`,
      `--sampler_name "${escapeForCommand(task.samplerName || DEFAULT_SCRIPT_SAMPLER)}"`,
      `--scheduler "${escapeForCommand(task.scheduler || DEFAULT_SCRIPT_SCHEDULER)}"`,
      `--clip_skip ${task.clipSkip ?? DEFAULT_SCRIPT_CLIP_SKIP}`,
      `--seed ${task.seed}`,
      `--batch_size ${task.batchSize ?? 1}`,
      `--n_iter ${task.nIter ?? 1}`
    ];

    if (task.hiresFix) {
      parts.push(
        "--enable_hr true",
        `--denoising_strength ${task.hiresDenoisingStrength ?? 0.4}`,
        `--hr_scale ${task.hiresScale ?? 1.5}`,
        `--hr_upscaler "${escapeForCommand(task.hiresUpscaler || "R-ESRGAN 4x+ Anime6B")}"`,
        `--hr_second_pass_steps ${task.hiresSteps ?? DEFAULT_SCRIPT_STEPS}`
      );

      if (task.hiresSamplerName) {
        parts.push(`--hr_sampler_name "${escapeForCommand(task.hiresSamplerName)}"`);
      }

      if (task.hiresScheduler) {
        parts.push(`--hr_scheduler "${escapeForCommand(task.hiresScheduler)}"`);
      }
    }

    if (task.adetailer) {
      parts.push("--adetailer true");
    }

    return parts.join(" ");
  }

  function formatForgeTaskCommands(tasks) {
    return tasks.map(formatForgeTaskCommand).join("\n");
  }

  function generateBatchCommands() {
    const commands = formatForgeTaskCommands(generateForgeTasks());

    const batchOutput = document.getElementById("batchOutput");
    if (batchOutput) {
      batchOutput.value = commands;
    }

    generatePrompt();
    return commands;
  }

  function generateForgeTasks(taskDefaults = getForgeTaskDefaults()) {
    const count = parseInt(document.getElementById("taskCount").value, 10) || 1;
    const width = getNumberInputValue("forgeWidth", 1024);
    const height = getNumberInputValue("forgeHeight", 1536);
    const seed = getNumberInputValue("forgeSeed", -1);
    const hiresFix = isHiresFixEnabled();
    const adetailer = isADetailerEnabled();

    const tasks = [];

    for (let i = 0; i < count; i++) {
      const data = buildPromptData({ sequenceIndex: i });
      const promptText = data.positivePrompt;

      tasks.push({
        prompt: promptText,
        negativePrompt: data.finalNegative,
        width,
        height,
        seed,
        hiresFix,
        adetailer,
        adetailerPrompts: buildADetailerPrompts(data.positiveCards),
        batchSize: 1,
        nIter: 1,
        steps: taskDefaults.steps,
        cfgScale: taskDefaults.cfgScale,
        samplerName: taskDefaults.samplerName,
        scheduler: taskDefaults.scheduler,
        clipSkip: taskDefaults.clipSkip,
        hiresDenoisingStrength: taskDefaults.hiresDenoisingStrength,
        hiresScale: taskDefaults.hiresScale,
        hiresSteps: taskDefaults.hiresSteps,
        hiresUpscaler: taskDefaults.hiresUpscaler,
        hiresSamplerName: taskDefaults.hiresSamplerName,
        hiresScheduler: taskDefaults.hiresScheduler,
        selectedCards: [
          ...data.positiveCards.map(card => getCardSnapshot(card, "positive")),
          ...data.negativeCards.map(card => getCardSnapshot(card, "negative"))
        ]
      });
    }

    return tasks;
  }

  function splitTaskCommandLines(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  }

  function tokenizeTaskCommand(line) {
    const tokens = [];
    let current = "";
    let quote = "";
    let escaping = false;

    for (const char of String(line || "")) {
      if (escaping) {
        current += char;
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (quote) {
        if (char === quote) {
          quote = "";
        } else {
          current += char;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }

      if (/\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = "";
        }
        continue;
      }

      current += char;
    }

    if (escaping) {
      current += "\\";
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  function taskCommandOptions(line) {
    const tokens = tokenizeTaskCommand(line);
    const options = {};

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (!token.startsWith("--")) continue;

      const key = token.slice(2);
      const nextToken = tokens[index + 1];

      if (!nextToken || nextToken.startsWith("--")) {
        options[key] = true;
        continue;
      }

      options[key] = nextToken;
      index += 1;
    }

    return options;
  }

  function parseCommandNumber(value, fallback, min, max) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, number));
  }

  function parseCommandBoolean(value, fallback = false) {
    if (value === true) return true;
    if (value === false) return false;

    const normalized = String(value ?? "").trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return fallback;
  }

  function taskFromCommandLine(line, fallbackTask) {
    const options = taskCommandOptions(line);
    const task = { ...fallbackTask };

    task.prompt = String(options.prompt ?? task.prompt ?? "");
    task.negativePrompt = String(options.negative_prompt ?? options.negativePrompt ?? task.negativePrompt ?? "");
    task.width = parseCommandNumber(options.width, task.width ?? 1024, 64, 2048);
    task.height = parseCommandNumber(options.height, task.height ?? 1536, 64, 2048);
    task.seed = parseCommandNumber(options.seed, task.seed ?? -1, -1, MAX_FORGE_SEED);
    task.batchSize = parseCommandNumber(options.batch_size ?? options.batchSize, task.batchSize ?? 1, 1, 8);
    task.nIter = parseCommandNumber(options.n_iter ?? options.nIter, task.nIter ?? 1, 1, 8);
    task.steps = parseCommandNumber(options.steps, task.steps ?? DEFAULT_SCRIPT_STEPS, 1, 150);
    task.cfgScale = parseCommandNumber(options.cfg_scale ?? options.cfgScale, task.cfgScale ?? DEFAULT_SCRIPT_CFG_SCALE, 1, 30);
    task.samplerName = String(options.sampler_name ?? options.samplerName ?? task.samplerName ?? DEFAULT_SCRIPT_SAMPLER);
    task.scheduler = String(options.scheduler ?? task.scheduler ?? DEFAULT_SCRIPT_SCHEDULER);
    task.clipSkip = parseCommandNumber(options.clip_skip ?? options.clipSkip, task.clipSkip ?? DEFAULT_SCRIPT_CLIP_SKIP, 1, 12);
    task.hiresFix = parseCommandBoolean(options.enable_hr ?? options.hiresFix, task.hiresFix);
    task.adetailer = parseCommandBoolean(options.adetailer ?? options.ADetailer, task.adetailer);
    task.hiresDenoisingStrength = parseCommandNumber(
      options.denoising_strength ?? options.hiresDenoisingStrength,
      task.hiresDenoisingStrength ?? 0.4,
      0,
      1
    );
    task.hiresScale = parseCommandNumber(options.hr_scale ?? options.hiresScale, task.hiresScale ?? 1.5, 1, 8);
    task.hiresSteps = parseCommandNumber(
      options.hr_second_pass_steps ?? options.hiresSteps,
      task.hiresSteps ?? DEFAULT_SCRIPT_STEPS,
      0,
      150
    );
    task.hiresUpscaler = String(options.hr_upscaler ?? options.hiresUpscaler ?? task.hiresUpscaler ?? "R-ESRGAN 4x+ Anime6B");
    task.hiresSamplerName = String(options.hr_sampler_name ?? options.hiresSamplerName ?? task.hiresSamplerName ?? "");
    task.hiresScheduler = String(options.hr_scheduler ?? options.hiresScheduler ?? task.hiresScheduler ?? "");

    return task;
  }

  function tasksFromCommandText(text, fallbackTasks) {
    const lines = splitTaskCommandLines(text);
    const baseTasks = Array.isArray(fallbackTasks) && fallbackTasks.length > 0
      ? fallbackTasks
      : generateForgeTasks();

    if (lines.length === 0) {
      return [];
    }

    return lines.map((line, index) => taskFromCommandLine(line, baseTasks[index] || baseTasks[baseTasks.length - 1] || {}));
  }

  function getForgeTaskImageCount(task) {
    const batchSize = parseCommandNumber(task?.batchSize ?? task?.batch_size, 1, 1, 8);
    const nIter = parseCommandNumber(task?.nIter ?? task?.n_iter, 1, 1, 8);
    return batchSize * nIter;
  }

  function getForgeTasksImageCount(tasks) {
    return tasks.reduce((total, task) => total + getForgeTaskImageCount(task), 0);
  }

  function copyText(text, successMessage) {
    if (!text.trim()) {
      alert("没有可复制的内容。");
      return;
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        alert(successMessage);
      }).catch(() => {
        fallbackCopyText(text, successMessage);
      });
    } else {
      fallbackCopyText(text, successMessage);
    }
  }

  function fallbackCopyText(text, successMessage) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      document.execCommand("copy");
      alert(successMessage);
    } catch {
      alert("复制失败，请手动复制。");
    }

    document.body.removeChild(textarea);
  }

  function copyPrompt() {
    const data = generatePrompt();
    const text = data.positivePrompt;
    copyText(text, "正向提示词已复制。");
  }

  function copyNegative() {
    const data = generatePrompt();
    const text = data.finalNegative;
    copyText(text, "最终负面提示词已复制。");
  }

  function copyBatch() {
    const batchOutput = document.getElementById("batchOutput");
    const text = batchOutput ? batchOutput.value : generateBatchCommands();
    copyText(text, "批量任务已复制。");
  }

  function copyTaskCommands() {
    const text = generateBatchCommands();
    if (text) {
      copyText(text, "任务已复制。");
    }
  }

  function collectCurrentLibraryData() {
    normalizeOutputPools();
    normalizePoolPresetData();

    return {
      categoryGroups,
      categories,
      cards,
      outputPools,
      poolPresetCategories,
      poolPresets,
      activePoolPresetCategoryId,
      taskCount: document.getElementById("taskCount").value,
      width: getInputValue("forgeWidth", "1024"),
      height: getInputValue("forgeHeight", "1536"),
      seed: getInputValue("forgeSeed", "-1"),
      hiresFix: isHiresFixEnabled(),
      adetailer: isADetailerEnabled(),
      isLibraryHidden,
      libraryCardColumns,
      activeCategoryGroupId,
      collapsedCategoryIds: Array.from(collapsedCategoryIds)
    };
  }

  function applyLibraryData(data) {
    if (!data) return;

    if (Array.isArray(data.categoryGroups) && data.categoryGroups.length > 0) {
      categoryGroups = data.categoryGroups.map(group => ({
        id: group.id || createId("group"),
        name: group.name || "未命名大类"
      }));
    }

    if (Array.isArray(data.categories) && data.categories.length > 0) {
      categories = data.categories.map(category => ({
        id: category.id || createId("cat"),
        groupId: category.groupId || "",
        name: category.name || "未命名分类"
      }));
    }

    normalizeCategoryGroupsAndCategories();

    const firstCategoryId = getFirstCategoryId();

    if (Array.isArray(data.cards)) {
      cards = data.cards.map(card => ({
        id: card.id || createId("card"),
        categoryId: card.categoryId || card.category || firstCategoryId,
        zh: card.zh || card.prompt || "",
        prompt: card.prompt || "",
        image: card.image || "",
        strength: clampPromptStrength(card.strength ?? 1),
        tags: typeof card.tags === "string" ? card.tags : ""
      }));

      cards.forEach(card => {
        if (!getCategoryById(card.categoryId)) {
          card.categoryId = firstCategoryId;
        }
      });
    }

    if (Array.isArray(data.outputPools)) {
      outputPools = data.outputPools.map(pool => ({
        id: pool.id || createId("pool"),
        name: normalizeOutputPoolNameLabel(pool.name, "未命名卡组"),
        mode: ["fixed", "random", "sequence", "all", "off"].includes(pool.mode) ? pool.mode : "random",
        target: ["positive", "negative"].includes(pool.target) ? pool.target : "positive",
        lockRole: "",
        cardIds: Array.isArray(pool.cardIds) ? Array.from(new Set(pool.cardIds)) : [],
        cardWeights: pool.cardWeights && typeof pool.cardWeights === "object" ? pool.cardWeights : {},
        cardStrengths: pool.cardStrengths && typeof pool.cardStrengths === "object" ? pool.cardStrengths : {}
      }));
    } else {
      outputPools = [];
    }

    if (Array.isArray(data.poolPresetCategories)) {
      poolPresetCategories = data.poolPresetCategories.map(category => ({
        id: category.id || createId("pool_preset_cat"),
        name: category.name || "未命名分类"
      }));
    } else {
      poolPresetCategories = [{ id: "pool_preset_default", name: "默认" }];
    }

    activePoolPresetCategoryId = data.activePoolPresetCategoryId || poolPresetCategories[0]?.id || "pool_preset_default";

    if (Array.isArray(data.poolPresets)) {
      poolPresets = data.poolPresets.map(normalizePoolPreset).filter(Boolean);
    } else {
      poolPresets = [];
    }

    normalizePoolPresetData();

    const validCardIds = new Set(cards.map(card => card.id));

    outputPools.forEach(pool => {
      pool.cardIds = pool.cardIds.filter(cardId => validCardIds.has(cardId));
      normalizePoolWeights(pool);
      normalizePoolStrengths(pool);
      if (!pool.target) {
        pool.target = "positive";
      }
    });

    normalizeOutputPools();

    if (data.taskCount !== undefined) {
      document.getElementById("taskCount").value = data.taskCount;
    }

    if (data.width !== undefined) {
      setInputValue("forgeWidth", data.width);
    }

    if (data.height !== undefined) {
      setInputValue("forgeHeight", data.height);
    }

    if (data.seed !== undefined) {
      setInputValue("forgeSeed", data.seed);
    }

    if (data.hiresFix !== undefined) {
      const hiresInput = document.getElementById("forgeHiresFix");
      if (hiresInput) {
        hiresInput.checked = Boolean(data.hiresFix);
      }
    }

    if (data.adetailer !== undefined) {
      setCheckboxValue("forgeADetailer", data.adetailer);
    }

    isLibraryHidden = Boolean(data.isLibraryHidden);
    libraryCardColumns = normalizeLibraryCardColumns(data.libraryCardColumns);

    if (Array.isArray(data.collapsedCategoryIds)) {
      collapsedCategoryIds = new Set(data.collapsedCategoryIds);
    } else {
      collapsedCategoryIds = new Set();
    }

    const nextActiveCategoryGroupId = data.activeCategoryGroupId === "works"
      ? "other"
      : data.activeCategoryGroupId;
    if (nextActiveCategoryGroupId && getCategoryGroupById(nextActiveCategoryGroupId)) {
      activeCategoryGroupId = nextActiveCategoryGroupId;
    }

    refreshCategorySelects();
    renderLibrary();
    renderOutputPools();
    generatePrompt();
    updateLibraryVisibilityUi();
  }

  function getLibraryNames() {
    const raw = localStorage.getItem(STORAGE_INDEX_KEY);

    if (!raw) return [];

    try {
      const names = JSON.parse(raw);
      return Array.isArray(names) ? names : [];
    } catch {
      return [];
    }
  }

  function setLibraryNames(names) {
    const uniqueNames = Array.from(new Set(names))
      .map(name => name.trim())
      .filter(name => name.length > 0)
      .sort((a, b) => a.localeCompare(b, "zh-CN"));

    localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(uniqueNames));
  }

  function getStorageKeyForName(name) {
    return STORAGE_ITEM_PREFIX + encodeURIComponent(name);
  }

  function refreshLibrarySelect() {
    const select = document.getElementById("librarySelect");
    const names = getLibraryNames();

    if (!select) return;

    select.innerHTML = "";

    if (names.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "尚未保存任何卡片库";
      select.appendChild(option);
      return;
    }

    names.forEach(name => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });

    const lastName = localStorage.getItem(STORAGE_LAST_KEY);

    if (lastName && names.includes(lastName)) {
      select.value = lastName;
      const nameInput = document.getElementById("libraryNameInput");
      if (nameInput) {
        nameInput.value = lastName;
      }
    }
  }

  async function saveNamedLibrary() {
    const name = document.getElementById("libraryNameInput")?.value.trim() || "";

    if (!name) {
      alert("请先填写卡片库名称。");
      return;
    }

    const names = getLibraryNames();
    const exists = names.includes(name);

    if (exists) {
      const confirmed = await showConfirmDialog(`卡片库“${name}”已存在。是否覆盖？`);
      if (!confirmed) return;
    }

    const data = collectCurrentLibraryData();

    localStorage.setItem(getStorageKeyForName(name), JSON.stringify(data));

    if (!exists) {
      names.push(name);
      setLibraryNames(names);
    }

    localStorage.setItem(STORAGE_LAST_KEY, name);

    refreshLibrarySelect();
    const select = document.getElementById("librarySelect");
    if (select) {
      select.value = name;
    }

    alert(`卡片库“${name}”已保存。`);
  }

  function loadSelectedLibrary() {
    const name = document.getElementById("librarySelect")?.value || "";

    if (!name) {
      alert("没有可调用的卡片库。");
      return;
    }

    const raw = localStorage.getItem(getStorageKeyForName(name));

    if (!raw) {
      alert(`找不到卡片库“${name}”的数据。`);
      refreshLibrarySelect();
      return;
    }

    try {
      const data = JSON.parse(raw);
      applyLibraryData(data);

      const nameInput = document.getElementById("libraryNameInput");
      if (nameInput) {
        nameInput.value = name;
      }
      localStorage.setItem(STORAGE_LAST_KEY, name);

      alert(`已调用卡片库“${name}”。`);
    } catch {
      alert(`卡片库“${name}”数据损坏，无法读取。`);
    }
  }

  async function deleteSelectedLibrary() {
    const name = document.getElementById("librarySelect")?.value || "";

    if (!name) {
      alert("没有可删除的卡片库。");
      return;
    }

    const confirmed = await showConfirmDialog(`确定删除卡片库“${name}”吗？此操作不可撤销。`);
    if (!confirmed) return;

    localStorage.removeItem(getStorageKeyForName(name));

    const names = getLibraryNames().filter(item => item !== name);
    setLibraryNames(names);

    if (localStorage.getItem(STORAGE_LAST_KEY) === name) {
      localStorage.removeItem(STORAGE_LAST_KEY);
    }

    refreshLibrarySelect();

    alert(`卡片库“${name}”已删除。`);
  }

  async function clearAllNamedLibraries() {
    const confirmed = await showConfirmDialog("确定要清空全部命名卡片库吗？此操作不可撤销。");
    if (!confirmed) return;

    const names = getLibraryNames();

    names.forEach(name => {
      localStorage.removeItem(getStorageKeyForName(name));
    });

    localStorage.removeItem(STORAGE_INDEX_KEY);
    localStorage.removeItem(STORAGE_LAST_KEY);

    const nameInput = document.getElementById("libraryNameInput");
    if (nameInput) {
      nameInput.value = "";
    }
    refreshLibrarySelect();

    alert("全部命名卡片库已清空。");
  }

  function exportCurrentLibraryJson() {
    const data = collectCurrentLibraryData();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json"
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    const name = document.getElementById("libraryNameInput")?.value.trim() || "sd_visual_prompt_library";

    a.href = url;
    a.download = `${name}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  function importJsonFile(event) {
    const file = event.target.files[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = function () {
      try {
        const data = JSON.parse(reader.result);
        applyLibraryData(data);
        alert("JSON 卡片库已导入。");
      } catch {
        alert("JSON 文件读取失败。");
      }

      event.target.value = "";
    };

    reader.readAsText(file, "utf-8");
  }

  function collectNamedLibrariesData() {
    return getLibraryNames()
      .map(name => {
        try {
          const raw = localStorage.getItem(getStorageKeyForName(name));
          const data = raw ? JSON.parse(raw) : null;
          return data ? { name, data } : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function getInputValue(id, fallback = "") {
    const input = document.getElementById(id);
    if (!input) return fallback;

    if (isForgeDimensionInputId(id)) {
      return String(normalizeForgeDimensionInput(id, fallback));
    }

    return input.value;
  }

  function isForgeDimensionInputId(id) {
    return id === "forgeWidth" || id === "forgeHeight";
  }

  function getForgeDimensionInputBounds(input) {
    const min = Number(input?.min);
    const max = Number(input?.max);

    return {
      min: Number.isFinite(min) ? min : FORGE_DIMENSION_STEP,
      max: Number.isFinite(max) ? max : 2048
    };
  }

  function normalizeForgeDimensionValue(value, fallback = 1024, bounds = {}) {
    const rawNumber = Number(value);
    const fallbackNumber = Number(fallback);
    const base = Number.isFinite(rawNumber)
      ? rawNumber
      : Number.isFinite(fallbackNumber) ? fallbackNumber : 1024;
    const step = FORGE_DIMENSION_STEP;
    const min = Number.isFinite(bounds.min) ? bounds.min : FORGE_DIMENSION_STEP;
    const max = Number.isFinite(bounds.max) ? bounds.max : 2048;
    const rounded = Math.round(base / step) * step;

    return Math.min(max, Math.max(min, rounded));
  }

  function normalizeForgeDimensionInput(id, fallback = 1024) {
    const input = document.getElementById(id);
    if (!input) return normalizeForgeDimensionValue(fallback, fallback);

    const normalized = normalizeForgeDimensionValue(input.value, fallback, getForgeDimensionInputBounds(input));
    input.value = String(normalized);
    return normalized;
  }

  function initializeForgeDimensionInputs() {
    ["forgeWidth", "forgeHeight"].forEach(id => {
      const input = document.getElementById(id);
      if (!input) return;

      input.step = String(FORGE_DIMENSION_STEP);
      input.min = input.min || String(FORGE_DIMENSION_STEP);
      input.max = input.max || "2048";
      ["change", "blur"].forEach(eventName => {
        input.addEventListener(eventName, () => normalizeForgeDimensionInput(id, id === "forgeHeight" ? 1536 : 1024));
      });
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          normalizeForgeDimensionInput(id, id === "forgeHeight" ? 1536 : 1024);
          input.blur();
        }
      });
      normalizeForgeDimensionInput(id, id === "forgeHeight" ? 1536 : 1024);
    });
  }

  function normalizeForgeSeedInputValue(value) {
    const text = String(value ?? "").trim();
    if (!text || text === "-") return text;

    const number = Number(text);
    if (!Number.isFinite(number)) return text;
    if (number > MAX_FORGE_SEED) return String(MAX_FORGE_SEED);
    if (number < -1) return "-1";
    return text;
  }

  function limitForgeSeedInput() {
    const input = document.getElementById("forgeSeed");
    if (!input) return;

    const nextValue = normalizeForgeSeedInputValue(input.value);
    if (nextValue !== input.value) {
      input.value = nextValue;
    }
  }

  function initializeForgeSeedInputLimit() {
    const input = document.getElementById("forgeSeed");
    if (!input) return;

    input.max = String(MAX_FORGE_SEED);
    ["input", "change", "blur"].forEach(eventName => {
      input.addEventListener(eventName, limitForgeSeedInput);
    });
    limitForgeSeedInput();
  }

  function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input && value !== undefined && value !== null) {
      if (id === "forgeSeed") {
        input.value = normalizeForgeSeedInputValue(value);
      } else if (isForgeDimensionInputId(id)) {
        input.value = String(normalizeForgeDimensionValue(value, id === "forgeHeight" ? 1536 : 1024, getForgeDimensionInputBounds(input)));
      } else {
        input.value = value;
      }
    }
  }

  function getCheckboxValue(id, fallback = false) {
    const input = document.getElementById(id);
    return input ? Boolean(input.checked) : fallback;
  }

  function setCheckboxValue(id, value) {
    const input = document.getElementById(id);
    if (input) {
      input.checked = Boolean(value);
    }
  }

  function collectCurrentSettings() {
    const detailedApp = document.getElementById("detailedApp");
    const launchRoot = document.getElementById("launchForgeRootPath");

    return {
      generation: {
        width: getInputValue("forgeWidth", "1024"),
        height: getInputValue("forgeHeight", "1536"),
        seed: getInputValue("forgeSeed", "-1"),
        taskCount: getInputValue("taskCount", "1"),
        hiresFix: getCheckboxValue("forgeHiresFix", false),
        adetailer: getCheckboxValue("forgeADetailer", false)
      },
      uiState: {
        page: detailedApp?.dataset.page || "market",
        marketView: "browse",
        libraryCardColumns,
        activeCategoryGroupId,
        activeCategoryId,
        collapsedCategoryIds: Array.from(collapsedCategoryIds)
      },
      forge: {
        root: launchRoot?.value || ""
      },
      currentImages: currentForgeImages.filter(Boolean)
    };
  }

  async function applyBackupSettings(settings) {
    if (!settings || typeof settings !== "object") return;

    const generation = settings.generation && typeof settings.generation === "object"
      ? settings.generation
      : {};

    setInputValue("forgeWidth", generation.width);
    setInputValue("forgeHeight", generation.height);
    setInputValue("forgeSeed", generation.seed);
    setInputValue("taskCount", generation.taskCount);

    if (generation.hiresFix !== undefined) {
      setCheckboxValue("forgeHiresFix", generation.hiresFix);
    }

    if (generation.adetailer !== undefined) {
      setCheckboxValue("forgeADetailer", generation.adetailer);
    }

    if (settings.forge?.root && window.forge?.setRoot) {
      try {
        const config = await window.forge.setRoot(settings.forge.root);
        setForgeRootPath(config.forgeRoot);
      } catch (error) {
        appendForgeLog({
          level: "warn",
          message: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        });
      }
    }

    if (Array.isArray(settings.currentImages) && settings.currentImages.length > 0) {
      renderForgeImages(settings.currentImages);
    } else {
      clearForgeImageResults();
    }

    const uiState = settings.uiState && typeof settings.uiState === "object"
      ? settings.uiState
      : {};

    if (uiState.activeCategoryId && categories.some(category => category.id === uiState.activeCategoryId)) {
      activeCategoryId = uiState.activeCategoryId;
    }

    const nextActiveCategoryGroupId = uiState.activeCategoryGroupId === "works"
      ? "other"
      : uiState.activeCategoryGroupId;
    if (nextActiveCategoryGroupId && getCategoryGroupById(nextActiveCategoryGroupId)) {
      activeCategoryGroupId = nextActiveCategoryGroupId;
    }

    libraryCardColumns = normalizeLibraryCardColumns(uiState.libraryCardColumns);

    if (Array.isArray(uiState.collapsedCategoryIds)) {
      collapsedCategoryIds = new Set(uiState.collapsedCategoryIds);
    }

    ensureActiveCategoryId();
    renderLibrary();
    renderOutputPools();
    generatePrompt();
    switchAppPage(uiState.page === "images" ? "images" : "market");
  }

  function collectFullBackupData() {
    normalizeOutputPools();

    return {
      app: "绘世光辉写真馆",
      version: 1,
      exportedAt: new Date().toISOString(),
      currentLibrary: collectCurrentLibraryData(),
      namedLibraries: collectNamedLibrariesData(),
      lastLibraryName: localStorage.getItem(STORAGE_LAST_KEY) || "",
      appearance: {
        launchBackground: appearanceSettings.launchBackground || "",
        appBackground: appearanceSettings.appBackground || ""
      },
      settings: collectCurrentSettings(),
      generationHistory: generationHistory.slice(0, HISTORY_LIMIT)
    };
  }

  function exportFullBackup() {
    const data = collectFullBackupData();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateText = new Date().toISOString().slice(0, 10);

    a.href = url;
    a.download = `绘世光辉写真馆_设置_${dateText}.json`;
    a.download = `绘世光辉写真馆_设置_${dateText}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  async function saveCurrentAsDefaultSettings() {
    if (!window.localApp?.saveDefaultBackup) {
      alert("当前环境无法写入默认设置。");
      return;
    }

    const confirmed = await showConfirmDialog("确定将当前卡片库、卡组、生图参数、背景和历史设置为下次启动默认设置吗？", {
      okText: "设为默认"
    });
    if (!confirmed) return;

    try {
      await window.localApp.saveDefaultBackup(collectFullBackupData());
      alert("已设置当前状态为默认设置。");
    } catch (error) {
      alert(error instanceof Error ? error.message : "默认设置写入失败。");
    }
  }

  function restoreNamedLibraries(namedLibraries, lastLibraryName) {
    if (!Array.isArray(namedLibraries)) return;

    getLibraryNames().forEach(name => {
      localStorage.removeItem(getStorageKeyForName(name));
    });

    const names = [];

    namedLibraries.forEach(entry => {
      if (!entry || typeof entry.name !== "string" || !entry.name.trim() || !entry.data) return;
      const name = entry.name.trim();
      localStorage.setItem(getStorageKeyForName(name), JSON.stringify(entry.data));
      names.push(name);
    });

    setLibraryNames(names);

    if (lastLibraryName && names.includes(lastLibraryName)) {
      localStorage.setItem(STORAGE_LAST_KEY, lastLibraryName);
    } else {
      localStorage.removeItem(STORAGE_LAST_KEY);
    }
  }

  async function applySettingsData(data) {
    if (!data || typeof data !== "object" || !data.currentLibrary) {
      throw new Error("设置文件数据无效。");
    }

    applyLibraryData(data.currentLibrary);
    restoreNamedLibraries(data.namedLibraries, data.lastLibraryName);

    if (data.appearance && typeof data.appearance === "object") {
      appearanceSettings = {
        launchBackground: typeof data.appearance.launchBackground === "string" ? data.appearance.launchBackground : "",
        appBackground: typeof data.appearance.appBackground === "string" ? data.appearance.appBackground : ""
      };
      saveAppearanceSettings();
      applyBackgroundImages();
    }

    generationHistory = Array.isArray(data.generationHistory)
      ? data.generationHistory.slice(0, HISTORY_LIMIT)
      : [];
    saveGenerationHistory();

    await applyBackupSettings(data.settings);
    refreshLibrarySelect();
    renderGenerationHistory();
  }

  async function importSettingsFile(event) {
    const file = event.target.files[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = async function () {
      try {
        const data = JSON.parse(reader.result);
        const confirmed = await showConfirmDialog("导入设置会覆盖当前卡片库、卡组、生图参数、背景设置和生成历史。确定继续吗？", {
          okText: "导入设置"
        });
        if (!confirmed) return;

        await applySettingsData(data);
        alert("设置已导入。");
      } catch (error) {
        alert(error instanceof Error ? error.message : "设置文件读取失败。");
      } finally {
        event.target.value = "";
      }
    };

    reader.readAsText(file, "utf-8");
  }

  async function importFullBackupFile(event) {
    const file = event.target.files[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = async function () {
      try {
        const data = JSON.parse(reader.result);

        if (!data || typeof data !== "object" || !data.currentLibrary) {
          throw new Error("Invalid backup data");
        }

        const confirmed = await showConfirmDialog("导入设置会覆盖当前卡片库、卡组、生图参数、背景设置和生成历史。确定继续吗？", {
          okText: "导入设置"
        });
        if (!confirmed) return;

        applyLibraryData(data.currentLibrary);
        restoreNamedLibraries(data.namedLibraries, data.lastLibraryName);

        if (data.appearance && typeof data.appearance === "object") {
          appearanceSettings = {
            launchBackground: typeof data.appearance.launchBackground === "string" ? data.appearance.launchBackground : "",
            appBackground: typeof data.appearance.appBackground === "string" ? data.appearance.appBackground : ""
          };
          saveAppearanceSettings();
          applyBackgroundImages();
        }

        generationHistory = Array.isArray(data.generationHistory)
          ? data.generationHistory.slice(0, HISTORY_LIMIT)
          : [];
        saveGenerationHistory();

        await applyBackupSettings(data.settings);
        refreshLibrarySelect();
        renderGenerationHistory();
        alert("设置已导入。");
      } catch (error) {
        alert(error instanceof Error ? error.message : "设置文件读取失败。");
      } finally {
        event.target.value = "";
      }
    };

    reader.readAsText(file, "utf-8");
  }

  async function loadInitialDefaultBackup() {
    if (!window.localApp?.getDefaultBackup) return;

    try {
      const data = await window.localApp.getDefaultBackup();

      if (!data || typeof data !== "object" || !data.currentLibrary) {
        return;
      }

      applyLibraryData(data.currentLibrary);
      restoreNamedLibraries(data.namedLibraries, data.lastLibraryName);

      if (data.appearance && typeof data.appearance === "object") {
        appearanceSettings = {
          launchBackground: typeof data.appearance.launchBackground === "string" ? data.appearance.launchBackground : "",
          appBackground: typeof data.appearance.appBackground === "string" ? data.appearance.appBackground : ""
        };
        saveAppearanceSettings();
        applyBackgroundImages();
      }

      generationHistory = Array.isArray(data.generationHistory)
        ? data.generationHistory.slice(0, HISTORY_LIMIT)
        : [];
      saveGenerationHistory();

      await applyBackupSettings(data.settings);
    } catch (error) {
      window.localApp?.writeLog?.(
        "warn",
        `Could not load 000.json default backup: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  function formatForgeLogTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "--:--:--";
    }

    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function appendForgeLog(entry) {
    const output = document.getElementById("forgeLogOutput");
    if (!output) return;

    const level = String(entry.level || "info").toUpperCase();
    const message = String(entry.message || "").trimEnd();
    const prefix = `[${formatForgeLogTime(entry.timestamp)}] [${level}]`;
    const nextLine = message ? `${prefix} ${message}` : prefix;

    output.value += output.value ? `\n${nextLine}` : nextLine;

    const maxLength = 60000;
    if (output.value.length > maxLength) {
      output.value = output.value.slice(output.value.length - maxLength);
    }

    output.scrollTop = output.scrollHeight;
  }

  function setLaunchProgress(percent, message) {
    const bar = document.getElementById("launchProgressBar");
    const status = document.getElementById("launchStatusText");

    if (bar) {
      bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }

    if (status && message) {
      status.textContent = message;
    }
  }

  function setForgeStartButtonsDisabled(disabled) {
    ["launchStartForgeButton"].forEach(id => {
      const button = document.getElementById(id);
      if (button) {
        button.disabled = disabled;
      }
    });
  }

  function setActiveButton(ids, activeId) {
    ids.forEach(id => {
      const button = document.getElementById(id);
      if (button) {
        button.classList.toggle("active", id === activeId);
      }
    });
  }

  function getOnboardingSteps() {
    return [
      {
        title: "准备绘世启动器",
        body: "确认已安装绘世启动器，推荐“绘世 2.9.0”，并且 WebUI 能正常出图。",
        items: ["准备好后点击下一步。"],
        primary: "下一步",
        secondary: "跳过向导"
      },
      {
        title: "选择绘世启动器路径",
        body: "点击“选择位置”，选择绘世 / sd-forge-aki 的根目录。",
        items: ["路径保存后，程序才能启动并连接 Forge。"],
        primary: "我已选好",
        secondary: "稍后再说"
      },
      {
        title: "启动 Forge",
        body: "点击“启动Forge 开始绘制”，等待进入工作台。",
        items: ["进入后即可用默认设置测试生图。"],
        primary: "我已进入工作台",
        secondary: "稍后再说"
      },
      {
        title: "默认生成一张",
        body: "进入生图页，点击“直接生图”。",
        items: ["生成 1 张测试图，用来确认连接和保存正常。"],
        primary: "我已生成一张",
        secondary: "稍后再说"
      },
      {
        title: "返回卡片库",
        body: "点击“返回卡片库”。",
        items: ["回到卡片库后开始编辑卡组。"],
        primary: "我已返回",
        secondary: "稍后再说"
      },
      {
        title: "展开外貌卡组",
        body: "点击外貌卡组条展开卡组。",
        items: ["展开后，点击卡片会加入这个卡组。"],
        primary: "已展开",
        secondary: "稍后再说"
      },
      {
        title: "加入第二张角色卡",
        body: "点击角色分类的第二张卡片。",
        items: ["卡片会加入已展开的外貌卡组。"],
        primary: "已加入",
        secondary: "稍后再说"
      },
      {
        title: "加入第三张角色卡",
        body: "点击角色分类的第三张卡片。",
        items: ["外貌卡组里会有多张可切换角色卡。"],
        primary: "已加入",
        secondary: "稍后再说"
      },
      {
        title: "收回外貌卡组",
        body: "再次点击外貌卡组条收回卡组。",
        items: ["收回后可以看到卡组模式按钮。"],
        primary: "已收回",
        secondary: "稍后再说"
      },
      {
        title: "切换为随机",
        body: "点击外貌卡组的模式按钮，切换到“随机”。",
        items: ["随机模式每次从卡组抽取一张卡。"],
        primary: "已随机",
        secondary: "稍后再说"
      },
      {
        title: "切换为顺序",
        body: "再次点击模式按钮，切换到“顺序”。",
        items: ["顺序模式会按卡片顺序生成系列图。"],
        primary: "已顺序",
        secondary: "稍后再说"
      },
      {
        title: "进入生图页",
        body: "点击“准备生图”。",
        items: ["进入生图页后设置生成数量。"],
        primary: "已进入",
        secondary: "稍后再说"
      },
      {
        title: "生成数量设为三张",
        body: "把“生成数量”改成 3。",
        items: ["接下来会生成三张系列图。"],
        primary: "数量已设为 3",
        secondary: "稍后再说"
      },
      {
        title: "开始生成三张",
        body: "点击“直接生图”。",
        items: ["三张图完成后，用作预设预览图组。"],
        primary: "已生成三张",
        secondary: "稍后再说"
      },
      {
        title: "返回卡片库",
        body: "点击“返回卡片库”。",
        items: ["回到卡片库后保存卡组预设。"],
        primary: "已返回",
        secondary: "稍后再说"
      },
      {
        title: "打开卡组预设",
        body: "点击“卡组预设”。",
        items: ["打开预设页面准备保存当前卡组。"],
        primary: "已打开",
        secondary: "稍后再说"
      },
      {
        title: "新增预设",
        body: "点击“新增”，输入名称并保存。",
        items: ["当前卡组和三张预览图会保存为卡组预设。"],
        primary: "完成向导",
        secondary: "完成向导"
      }
    ];
  }

  function isOnboardingCompleted() {
    try {
      const raw = localStorage.getItem(STORAGE_ONBOARDING_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return Boolean(parsed.completed);
    } catch {
      return false;
    }
  }

  function saveOnboardingCompleted() {
    localStorage.setItem(STORAGE_ONBOARDING_KEY, JSON.stringify({
      completed: true,
      completedAt: new Date().toISOString()
    }));
  }

  function getOnboardingStepCount() {
    return getOnboardingSteps().length;
  }

  function getSyncedOnboardingStep(step) {
    const pool = getOnboardingAppearancePool();
    if (!pool) return step;

    const roleCategory = getOnboardingRoleCategory();
    const roleCards = roleCategory ? cards.filter(card => card.categoryId === roleCategory.id) : [];
    const secondRoleCardId = roleCards[1]?.id || "";
    const thirdRoleCardId = roleCards[2]?.id || "";
    const poolCardIds = Array.isArray(pool.cardIds) ? pool.cardIds : [];
    const presetDialog = document.getElementById("poolPresetDialog");
    const isPresetDialogOpen = Boolean(presetDialog && !presetDialog.classList.contains("hidden"));
    const taskCount = Number(document.getElementById("taskCount")?.value || 0);

    if (step === 5 && expandedOutputPoolId === pool.id) return 6;
    if (step === 6 && secondRoleCardId && poolCardIds.includes(secondRoleCardId)) return 7;
    if (step === 7 && thirdRoleCardId && poolCardIds.includes(thirdRoleCardId)) return 8;
    if (step === 8 && expandedOutputPoolId !== pool.id) return 9;
    if (step === 9 && pool.mode === "random") return 10;
    if (step === 10 && pool.mode === "sequence") return 11;
    if (step === 12 && taskCount >= 3) return 13;
    if (step === 15 && isPresetDialogOpen) return 16;

    return step;
  }

  function setOnboardingStep(step) {
    const maxIndex = getOnboardingStepCount() - 1;
    const requestedStep = Math.max(0, Math.min(maxIndex, Math.floor(Number(step) || 0)));
    const syncedStep = getSyncedOnboardingStep(requestedStep);
    onboardingGuideState.step = Math.max(0, Math.min(maxIndex, syncedStep));
    onboardingGuideState.manualPosition = false;
    renderOnboardingGuide();
  }

  function openOnboardingGuide(step = 0) {
    onboardingGuideState.active = true;
    onboardingGuideState.manualPosition = false;
    setOnboardingStep(step);
  }

  function closeOnboardingGuide({ complete = false } = {}) {
    const guide = document.getElementById("onboardingGuide");
    onboardingGuideState.active = false;

    if (complete) {
      saveOnboardingCompleted();
    }

    if (guide) {
      guide.classList.add("hidden");
    }
    clearOnboardingTargetHighlight();
  }

  function restartOnboardingGuide() {
    onboardingGuideState.active = true;
    setOnboardingStep(0);
  }

  function completeOnboardingGuide(message = "启动向导已完成。") {
    closeOnboardingGuide({ complete: true });
    alert(message);
  }

  function isLaunchScreenVisible() {
    const launchScreen = document.getElementById("launchScreen");
    return Boolean(launchScreen && !launchScreen.classList.contains("hidden"));
  }

  function getDetailedAppPage() {
    return document.getElementById("detailedApp")?.dataset.page || "market";
  }

  function getVisibleOnboardingTarget(selector) {
    if (!selector) return null;

    const candidates = Array.from(document.querySelectorAll(selector));
    return candidates.find(element => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none";
    }) || null;
  }

  function normalizeOnboardingText(text) {
    return String(text || "").trim().toLowerCase();
  }

  function getOnboardingAppearancePool() {
    normalizeOutputPools();

    const pools = outputPools.filter(pool => !isLockedOutputPool(pool));
    return pools.find(pool => /外貌|appearance/.test(normalizeOnboardingText(pool.name))) ||
      pools.find(pool => /人物|角色|character/.test(normalizeOnboardingText(pool.name))) ||
      pools[0] ||
      null;
  }

  function getOnboardingAppearancePoolElement(part = "top") {
    const pool = getOnboardingAppearancePool();
    if (!pool) return null;

    const poolElement = Array.from(document.querySelectorAll(".output-pool"))
      .find(element => element.dataset.poolId === pool.id);
    if (!poolElement) return null;

    if (part === "mode") {
      return poolElement.querySelector(".pool-mode-toggle-button") || poolElement.querySelector(".pool-actions button");
    }

    return poolElement.querySelector(".pool-top") || poolElement;
  }

  function getOnboardingRoleCategory() {
    return categories.find(category => /角色|人物|character/.test(normalizeOnboardingText(category.name))) ||
      categories.find(category => {
        const group = getCategoryGroupById(category.groupId);
        return /人物|角色|character/.test(normalizeOnboardingText(group?.name));
      }) ||
      null;
  }

  function getOnboardingRoleCategoryTab() {
    const category = getOnboardingRoleCategory();
    if (!category) return null;

    if (activeCategoryGroupId !== category.groupId) {
      return Array.from(document.querySelectorAll(".category-group-tab"))
        .find(element => element.dataset.groupId === category.groupId) || null;
    }

    return Array.from(document.querySelectorAll(".category-tab"))
      .find(element => element.dataset.categoryId === category.id) || null;
  }

  function getOnboardingRoleCardElement(cardIndex) {
    const roleCategory = getOnboardingRoleCategory();
    if (!roleCategory) return getVisibleOnboardingTarget(".library-card");

    if (activeCategoryId !== roleCategory.id) {
      return getOnboardingRoleCategoryTab();
    }

    const cardElements = Array.from(document.querySelectorAll(".library-card"))
      .filter(element => element.dataset.categoryId === roleCategory.id);
    return cardElements[cardIndex] || cardElements[cardElements.length - 1] || null;
  }

  function getOnboardingTargetElement(stepIndex) {
    const page = getDetailedAppPage();
    const presetDialog = document.getElementById("poolPresetDialog");
    const isPresetDialogOpen = Boolean(presetDialog && !presetDialog.classList.contains("hidden"));

    if (stepIndex === 5) return getOnboardingAppearancePoolElement("top");
    if (stepIndex === 6) return getOnboardingRoleCardElement(1);
    if (stepIndex === 7) return getOnboardingRoleCardElement(2);
    if (stepIndex === 8) return getOnboardingAppearancePoolElement("top");
    if (stepIndex === 9 || stepIndex === 10) return getOnboardingAppearancePoolElement("mode");
    if (stepIndex === 15) return isPresetDialogOpen ? getVisibleOnboardingTarget("#poolPresetSaveButton") : getVisibleOnboardingTarget("#openPoolPresetButton");
    if (stepIndex === 16) return getVisibleOnboardingTarget("#poolPresetSaveButton");

    return getVisibleOnboardingTarget(getOnboardingTargetSelector(stepIndex));
  }

  function getOnboardingTargetSelector(stepIndex) {
    const page = getDetailedAppPage();
    const presetDialog = document.getElementById("poolPresetDialog");
    const isPresetDialogOpen = Boolean(presetDialog && !presetDialog.classList.contains("hidden"));

    if (stepIndex === 0) return "";
    if (stepIndex === 1) return "#launchChooseForgeRootButton";
    if (stepIndex === 2) return "#launchStartForgeButton";
    if (stepIndex === 3) return page === "images" ? "#generateForgeImageButton" : "#prepareGenerateSwitchButton";
    if (stepIndex === 4) return page === "images" ? "#returnMarketButton" : "#libraryContainer";
    if (stepIndex === 11) return page === "images" ? "#taskCount" : "#prepareGenerateSwitchButton";
    if (stepIndex === 12) return page === "images" ? "#taskCount" : "#prepareGenerateSwitchButton";
    if (stepIndex === 13) return page === "images" ? "#generateForgeImageButton" : "#prepareGenerateSwitchButton";
    if (stepIndex === 14) return page === "images" ? "#returnMarketButton" : "#openPoolPresetButton";
    if (stepIndex === 15) return isPresetDialogOpen ? "#poolPresetSaveButton" : "#openPoolPresetButton";
    if (stepIndex === 16) return "#poolPresetSaveButton";

    return "";
  }

  function clearOnboardingTargetHighlight() {
    if (onboardingTargetElement) {
      onboardingTargetElement.classList.remove("onboarding-guide-target");
      onboardingTargetElement = null;
    }
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getRectOverlapArea(leftRect, rightRect) {
    const width = Math.max(0, Math.min(leftRect.right, rightRect.right) - Math.max(leftRect.left, rightRect.left));
    const height = Math.max(0, Math.min(leftRect.bottom, rightRect.bottom) - Math.max(leftRect.top, rightRect.top));
    return width * height;
  }

  function positionOnboardingGuide() {
    onboardingPlacementFrame = null;

    const guide = document.getElementById("onboardingGuide");
    const card = guide?.querySelector(".onboarding-guide-card");
    if (!guide || !card || !onboardingGuideState.active || guide.classList.contains("hidden")) {
      clearOnboardingTargetHighlight();
      return;
    }

    const target = getOnboardingTargetElement(onboardingGuideState.step);
    clearOnboardingTargetHighlight();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const margin = 14;
    const guideWidth = guide.offsetWidth || 390;
    const guideHeight = card.offsetHeight || guide.offsetHeight || 240;
    const maxLeft = Math.max(margin, viewportWidth - guideWidth - margin);
    const maxTop = Math.max(margin, viewportHeight - guideHeight - margin);

    if (!target) {
      guide.removeAttribute("data-placement");
      const left = onboardingGuideState.manualPosition ? onboardingGuideState.x : 22;
      const top = onboardingGuideState.manualPosition ? onboardingGuideState.y : viewportHeight - guideHeight - 22;
      onboardingGuideState.x = clampNumber(left, margin, maxLeft);
      onboardingGuideState.y = clampNumber(top, margin, maxTop);
      guide.style.left = `${onboardingGuideState.x}px`;
      guide.style.top = `${onboardingGuideState.y}px`;
      return;
    }

    const targetRect = target.getBoundingClientRect();
    const gap = 26;

    if (
      targetRect.bottom < 0 ||
      targetRect.top > viewportHeight ||
      targetRect.right < 0 ||
      targetRect.left > viewportWidth
    ) {
      target.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      window.setTimeout(scheduleOnboardingPlacement, 260);
      return;
    }

    onboardingTargetElement = target;
    target.classList.add("onboarding-guide-target");

    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const avoidRect = {
      left: targetRect.left - 10,
      top: targetRect.top - 10,
      right: targetRect.right + 10,
      bottom: targetRect.bottom + 10
    };
    const candidates = [
      {
        placement: "right",
        left: targetRect.right + gap,
        top: targetCenterY - guideHeight / 2
      },
      {
        placement: "left",
        left: targetRect.left - guideWidth - gap,
        top: targetCenterY - guideHeight / 2
      },
      {
        placement: "bottom",
        left: targetCenterX - guideWidth / 2,
        top: targetRect.bottom + gap
      },
      {
        placement: "top",
        left: targetCenterX - guideWidth / 2,
        top: targetRect.top - guideHeight - gap
      }
    ];
    const candidate = candidates
      .map((item, index) => {
        const left = clampNumber(item.left, margin, maxLeft);
        const top = clampNumber(item.top, margin, maxTop);
        const rect = {
          left,
          top,
          right: left + guideWidth,
          bottom: top + guideHeight
        };
        const overlapPenalty = getRectOverlapArea(rect, avoidRect) * 1000;
        const clampPenalty = Math.abs(left - item.left) + Math.abs(top - item.top);
        const orderPenalty = index * 12;

        return {
          ...item,
          left,
          top,
          score: overlapPenalty + clampPenalty + orderPenalty
        };
      })
      .sort((left, right) => left.score - right.score)[0] || candidates[2];

    const left = onboardingGuideState.manualPosition
      ? clampNumber(onboardingGuideState.x, margin, maxLeft)
      : candidate.left;
    const top = onboardingGuideState.manualPosition
      ? clampNumber(onboardingGuideState.y, margin, maxTop)
      : candidate.top;
    onboardingGuideState.x = left;
    onboardingGuideState.y = top;
    const guideCenterX = left + guideWidth / 2;
    const guideCenterY = top + guideHeight / 2;
    const manualPlacement = Math.abs(targetCenterX - guideCenterX) > Math.abs(targetCenterY - guideCenterY)
      ? (guideCenterX < targetCenterX ? "left" : "right")
      : (guideCenterY < targetCenterY ? "top" : "bottom");
    const arrowX = clampNumber(targetCenterX - left, 18, guideWidth - 18);
    const arrowY = clampNumber(targetCenterY - top, 18, guideHeight - 18);

    guide.dataset.placement = onboardingGuideState.manualPosition ? manualPlacement : candidate.placement;
    guide.style.left = `${left}px`;
    guide.style.top = `${top}px`;
    guide.style.setProperty("--onboarding-arrow-x", `${arrowX}px`);
    guide.style.setProperty("--onboarding-arrow-y", `${arrowY}px`);
  }

  function scheduleOnboardingPlacement() {
    if (onboardingPlacementFrame) return;
    onboardingPlacementFrame = window.requestAnimationFrame(positionOnboardingGuide);
  }

  function startOnboardingGuideDrag(event) {
    const guide = document.getElementById("onboardingGuide");
    if (!guide || event.button !== 0 || event.target.closest("button, input, select, textarea, label")) return;

    const rect = guide.getBoundingClientRect();
    onboardingDragState = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      guideX: rect.left,
      guideY: rect.top
    };
    onboardingGuideState.manualPosition = true;
    onboardingGuideState.x = rect.left;
    onboardingGuideState.y = rect.top;
    guide.classList.add("is-dragging");
    event.preventDefault();
  }

  function moveOnboardingGuideDrag(event) {
    if (!onboardingDragState) return;

    onboardingGuideState.x = onboardingDragState.guideX + event.clientX - onboardingDragState.pointerX;
    onboardingGuideState.y = onboardingDragState.guideY + event.clientY - onboardingDragState.pointerY;
    scheduleOnboardingPlacement();
  }

  function stopOnboardingGuideDrag() {
    if (!onboardingDragState) return;

    onboardingDragState = null;
    document.getElementById("onboardingGuide")?.classList.remove("is-dragging");
  }

  function renderOnboardingGuide() {
    const guide = document.getElementById("onboardingGuide");
    const stepLabel = document.getElementById("onboardingGuideStep");
    const title = document.getElementById("onboardingGuideTitle");
    const body = document.getElementById("onboardingGuideBody");
    const list = document.getElementById("onboardingGuideList");
    const progress = document.getElementById("onboardingGuideProgressBar");
    const back = document.getElementById("onboardingGuideBack");
    const primary = document.getElementById("onboardingGuidePrimary");
    const secondary = document.getElementById("onboardingGuideSecondary");
    const steps = getOnboardingSteps();
    const step = steps[onboardingGuideState.step];

    if (!guide || !step || !stepLabel || !title || !body || !list || !progress || !back || !primary || !secondary) return;

    guide.classList.toggle("hidden", !onboardingGuideState.active);
    stepLabel.textContent = `启动向导 ${onboardingGuideState.step + 1} / ${steps.length}`;
    title.textContent = step.title;
    body.textContent = step.body;
    list.replaceChildren(...step.items.map(item => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    }));
    progress.style.width = `${((onboardingGuideState.step + 1) / steps.length) * 100}%`;
    back.disabled = onboardingGuideState.step <= 0;
    primary.textContent = step.primary;
    secondary.textContent = step.secondary;
    scheduleOnboardingPlacement();
  }

  function setOnboardingButtonsDisabled(disabled) {
    const back = document.getElementById("onboardingGuideBack");
    const primary = document.getElementById("onboardingGuidePrimary");
    const secondary = document.getElementById("onboardingGuideSecondary");
    if (back) back.disabled = disabled || onboardingGuideState.step <= 0;
    if (primary) primary.disabled = disabled;
    if (secondary) secondary.disabled = disabled;
  }

  function handleOnboardingBackAction() {
    if (onboardingGuideState.step <= 0) return;

    setOnboardingStep(onboardingGuideState.step - 1);
  }

  function handleOnboardingPrimaryAction() {
    const step = onboardingGuideState.step;

    if (step >= getOnboardingStepCount() - 1) {
      completeOnboardingGuide();
      return;
    }

    setOnboardingStep(step + 1);
  }

  function handleOnboardingSecondaryAction() {
    const step = onboardingGuideState.step;

    if (step === 0) {
      closeOnboardingGuide({ complete: true });
      return;
    }

    if (step >= getOnboardingStepCount() - 1) {
      completeOnboardingGuide();
      return;
    }

    closeOnboardingGuide();
  }

  function isOnboardingAppearancePoolId(poolId) {
    return Boolean(poolId && getOnboardingAppearancePool()?.id === poolId);
  }

  function isOnboardingRoleCardId(cardId, cardIndex) {
    const roleCategory = getOnboardingRoleCategory();
    if (!roleCategory) return false;

    const roleCards = cards.filter(card => card.categoryId === roleCategory.id);
    return roleCards[cardIndex]?.id === cardId;
  }

  function advanceOnboardingAfterPoolToggle(poolId) {
    if (!onboardingGuideState.active || !isOnboardingAppearancePoolId(poolId)) return;

    if (onboardingGuideState.step === 5 && expandedOutputPoolId === poolId) {
      setOnboardingStep(6);
      return;
    }

    if (onboardingGuideState.step === 8 && expandedOutputPoolId !== poolId) {
      setOnboardingStep(9);
    }
  }

  function advanceOnboardingAfterCardAdded(cardId, poolId) {
    if (!onboardingGuideState.active || !isOnboardingAppearancePoolId(poolId)) return;

    if (onboardingGuideState.step === 6 && isOnboardingRoleCardId(cardId, 1)) {
      setOnboardingStep(7);
      return;
    }

    if (onboardingGuideState.step === 7 && isOnboardingRoleCardId(cardId, 2)) {
      setOnboardingStep(8);
    }
  }

  function advanceOnboardingAfterPoolModeChange(poolId) {
    if (!onboardingGuideState.active || !isOnboardingAppearancePoolId(poolId)) return;

    const pool = outputPools.find(item => item.id === poolId);
    if (onboardingGuideState.step === 9 && pool?.mode === "random") {
      setOnboardingStep(10);
      return;
    }

    if (onboardingGuideState.step === 10 && pool?.mode === "sequence") {
      setOnboardingStep(11);
    }
  }

  function advanceOnboardingAfterGeneration() {
    if (!onboardingGuideState.active) return;

    const generatedCount = currentForgeImages.filter(Boolean).length;

    if (onboardingGuideState.step === 3 && generatedCount >= 1) {
      setOnboardingStep(4);
      return;
    }

    if (onboardingGuideState.step === 13 && generatedCount >= 3) {
      setOnboardingStep(14);
    }
  }

  function advanceOnboardingAfterTaskCountChange() {
    if (!onboardingGuideState.active || onboardingGuideState.step !== 12) return;

    const count = Number(document.getElementById("taskCount")?.value || 0);
    if (count >= 3) {
      setOnboardingStep(13);
    } else {
      scheduleOnboardingPlacement();
    }
  }

  function initializeOnboardingGuide() {
    const guide = document.getElementById("onboardingGuide");
    const closeButton = document.getElementById("onboardingGuideClose");
    const guideTop = guide?.querySelector(".onboarding-guide-top");
    const back = document.getElementById("onboardingGuideBack");
    const primary = document.getElementById("onboardingGuidePrimary");
    const secondary = document.getElementById("onboardingGuideSecondary");
    const taskCountInput = document.getElementById("taskCount");

    closeButton?.addEventListener("click", () => closeOnboardingGuide());
    guideTop?.addEventListener("mousedown", startOnboardingGuideDrag);
    back?.addEventListener("click", handleOnboardingBackAction);
    primary?.addEventListener("click", async () => {
      setOnboardingButtonsDisabled(true);
      try {
        await handleOnboardingPrimaryAction();
      } finally {
        setOnboardingButtonsDisabled(false);
      }
    });
    secondary?.addEventListener("click", handleOnboardingSecondaryAction);
    taskCountInput?.addEventListener("input", advanceOnboardingAfterTaskCountChange);
    taskCountInput?.addEventListener("change", advanceOnboardingAfterTaskCountChange);
    window.addEventListener("mousemove", moveOnboardingGuideDrag);
    window.addEventListener("mouseup", stopOnboardingGuideDrag);
    window.addEventListener("resize", scheduleOnboardingPlacement);
    window.addEventListener("scroll", scheduleOnboardingPlacement, true);

    if (guide && !isOnboardingCompleted()) {
      openOnboardingGuide(0);
    }
  }

  function switchAppPage(page) {
    const detailedApp = document.getElementById("detailedApp");
    const nextPage = ["market", "images"].includes(page) ? page : "market";

    if (detailedApp) {
      detailedApp.dataset.page = nextPage;
      if (nextPage === "market") {
        detailedApp.dataset.marketView = "browse";
      }
    }

    if (nextPage === "market") {
      const promptLibraryTitle = document.getElementById("promptLibraryTitle");
      if (promptLibraryTitle) {
        promptLibraryTitle.textContent = "卡片库";
      }
      renderLibrary();
    }

    if (onboardingGuideState.active) {
      if (onboardingGuideState.step === 4 && nextPage === "market") {
        setOnboardingStep(5);
      } else if (onboardingGuideState.step === 11 && nextPage === "images") {
        setOnboardingStep(12);
      } else if (onboardingGuideState.step === 14 && nextPage === "market") {
        setOnboardingStep(15);
      } else {
        scheduleOnboardingPlacement();
      }
    }
    window.scrollTo(0, 0);
  }

  function switchMarketView(view) {
    const detailedApp = document.getElementById("detailedApp");
    const promptLibraryTitle = document.getElementById("promptLibraryTitle");
    const nextView = view === "edit" ? "edit" : "browse";

    if (detailedApp) {
      detailedApp.dataset.marketView = nextView;
    }

    if (promptLibraryTitle) {
      promptLibraryTitle.textContent = nextView === "edit" ? "编辑卡片库" : "卡片库";
    }

    cancelEditCard();
    renderLibrary();
  }

  function enterDetailedApp() {
    const launchScreen = document.getElementById("launchScreen");
    const detailedApp = document.getElementById("detailedApp");

    if (launchScreen) {
      launchScreen.classList.add("hidden");
    }

    if (detailedApp) {
      detailedApp.classList.remove("app-hidden");
    }

    switchAppPage("market");
    if (onboardingGuideState.active && onboardingGuideState.step === 2) {
      setOnboardingStep(3);
    }
    window.scrollTo(0, 0);
  }

  function setForgeStatus(entry) {
    const status = document.getElementById("forgeStatus");
    const statusValue = String(entry.status || "unknown");
    const message = String(entry.message || "");

    if (status) {
      status.className = `forge-status status-${statusValue}`;
      status.textContent = message || statusValue;
    }

    if (statusValue === "ready") {
      if (!forgeLaunchRequested) {
        setLaunchProgress(100, "检测到已有 Forge 后台。点击启动Forge 开始绘制将直接进入主界面。");
        setForgeStartButtonsDisabled(false);
        return;
      }

      if (!forgeEnterDetailedOnReady) {
        forgeLaunchRequested = false;
        forgeEnterDetailedOnReady = true;
        setLaunchProgress(100, "Forge 重载完成");
        setForgeGenerateStatus("Forge 重载完成，可以继续生图。");
        setForgeStartButtonsDisabled(false);
        return;
      }

      setLaunchProgress(100, "Forge后台已启动，正在进入详细界面...");
      setForgeStartButtonsDisabled(false);
      setTimeout(enterDetailedApp, 600);
      return;
    }

    if (statusValue === "starting") {
      setLaunchProgress(68, message || "Forge 正在后台启动...");
      setForgeStartButtonsDisabled(true);
      return;
    }

    if (statusValue === "error") {
      forgeLaunchRequested = false;
      forgeEnterDetailedOnReady = true;
      setLaunchProgress(0, message || "Forge 启动失败");
      setForgeStartButtonsDisabled(false);
      return;
    }

    if (statusValue === "stopped") {
      if (!forgeLaunchRequested) {
        forgeLaunchRequested = false;
      }
      setLaunchProgress(0, message || "Forge 已停止");
      setForgeStartButtonsDisabled(false);
    }
  }

  function setForgeRootPath(forgeRoot) {
    ["launchForgeRootPath"].forEach(id => {
      const input = document.getElementById(id);
      if (input) {
        input.value = forgeRoot || "";
      }
    });
  }

  async function initializeForgePanel() {
    if (!window.forge) {
      appendForgeLog({
        level: "warn",
        message: "Forge bridge is unavailable.",
        timestamp: new Date().toISOString()
      });
      return;
    }

    window.forge.onLog(appendForgeLog);
    window.forge.onStatus(setForgeStatus);
    window.forge.onImageGenerated?.(handleForgeImageGenerated);

    try {
      const config = await window.forge.getConfig();
      setForgeRootPath(config.forgeRoot);
      if (!config.forgeRoot) {
        setLaunchProgress(0, "请选择 Forge 文件位置。");
      }

      const apiStatus = await window.forge.checkApi();
      if (apiStatus && apiStatus.available) {
        setLaunchProgress(100, "检测到已有 Forge 后台。点击启动Forge 开始绘制将直接进入主界面。");
        setForgeStartButtonsDisabled(false);
        return;
      }
      if (config.forgeRoot) {
        setLaunchProgress(0, "Forge 路径已保存，点击启动开始绘制。");
      }
    } catch (error) {
      appendForgeLog({
        level: "error",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  }

  async function chooseForgeRoot() {
    if (!window.forge) return false;

    try {
      const config = await window.forge.chooseRoot();
      setForgeRootPath(config.forgeRoot);
      if (config.forgeRoot) {
        setLaunchProgress(0, "Forge 路径已保存，点击启动开始绘制。");
        if (onboardingGuideState.active && onboardingGuideState.step === 1) {
          setOnboardingStep(2);
        }
        return true;
      }
      return false;
    } catch (error) {
      appendForgeLog({
        level: "error",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      alert(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async function startForge(options = {}) {
    if (!window.forge) return;

    forgeLaunchRequested = true;
    forgeEnterDetailedOnReady = options.enterDetailedOnReady !== false;
    setForgeStartButtonsDisabled(true);
    setLaunchProgress(24, "正在启动或重启 Forge 后台服务...");

    try {
      await window.forge.start();
    } catch (error) {
      forgeLaunchRequested = false;
      forgeEnterDetailedOnReady = true;
      setForgeStartButtonsDisabled(false);
      setLaunchProgress(0, "Forge 启动失败");
      appendForgeLog({
        level: "error",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function launchStartForge() {
    if (!window.forge) return;

    setForgeStartButtonsDisabled(true);
    setLaunchProgress(16, "正在检测 Forge API 状态...");

    try {
      const apiStatus = await window.forge.checkApi();

      if (apiStatus && apiStatus.available) {
        forgeLaunchRequested = false;
        forgeEnterDetailedOnReady = true;
        setLaunchProgress(100, "Forge 已正常运行，正在进入主界面...");
        setForgeStartButtonsDisabled(false);
        setTimeout(enterDetailedApp, 300);
        return;
      }

      setLaunchProgress(20, "Forge 状态异常或未启动，正在重启后台服务...");
      await startForge();
    } catch (error) {
      appendForgeLog({
        level: "warn",
        message: `Forge 状态检测失败，准备重启：${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date().toISOString()
      });
      setLaunchProgress(20, "Forge 状态检测失败，正在重启后台服务...");
      await startForge();
    }
  }

  async function reloadForge() {
    if (!window.forge) return;

    appendForgeLog({
      level: "info",
      message: "正在重载 Forge...",
      timestamp: new Date().toISOString()
    });
    setForgeGenerateStatus("正在重载 Forge...");
    await startForge({ enterDetailedOnReady: false });
  }

  function getNumberInputValue(id, fallback) {
    if (id === "forgeSeed") {
      limitForgeSeedInput();
    }

    if (isForgeDimensionInputId(id)) {
      return normalizeForgeDimensionInput(id, fallback);
    }

    const input = document.getElementById(id);
    const value = Number(input ? input.value : fallback);

    return Number.isFinite(value) ? value : fallback;
  }

  function isHiresFixEnabled() {
    return Boolean(document.getElementById("forgeHiresFix")?.checked);
  }

  function isADetailerEnabled() {
    return Boolean(document.getElementById("forgeADetailer")?.checked);
  }

  function setForgeGenerateStatus(message) {
    const status = document.getElementById("forgeGenerateStatus");
    if (status) {
      status.textContent = message;
    }
  }

  function setForgeGenerationControls(running) {
    forgeGenerationRunning = running;
    if (!running) {
      forgeGenerationPaused = false;
    }

    const generateButton = document.getElementById("generateForgeImageButton");
    const customButton = document.getElementById("customForgeImageButton");
    const stopButton = document.getElementById("stopForgeImageButton");
    const pauseButton = document.getElementById("pauseForgeImageButton");
    const resumeButton = document.getElementById("resumeForgeImageButton");
    const skipButton = document.getElementById("skipForgeImageButton");

    if (generateButton) {
      generateButton.disabled = running;
    }

    if (customButton) {
      customButton.disabled = running;
    }

    if (stopButton) {
      stopButton.disabled = !running;
    }

    if (pauseButton) {
      pauseButton.disabled = !running || forgeGenerationPaused;
    }

    if (resumeButton) {
      resumeButton.disabled = !running || !forgeGenerationPaused;
    }

    if (skipButton) {
      skipButton.disabled = !running;
    }
  }

  function formatElapsedTime(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes <= 0) {
      return `${seconds}秒`;
    }

    return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
  }

  function getForgeGenerationElapsedText() {
    if (!forgeGenerationStartedAt) {
      return "";
    }

    return `用时 ${formatElapsedTime(Date.now() - forgeGenerationStartedAt)}`;
  }

  function updateForgeGenerationProgressStatus(prefix = "已生成") {
    const finishedCount = currentForgeImages.filter(Boolean).length;
    const total = forgeGenerationTotal || currentForgeImages.length || finishedCount;
    const elapsedText = getForgeGenerationElapsedText();
    const suffix = elapsedText ? ` · ${elapsedText}` : "";
    setForgeGenerateStatus(`${prefix} ${finishedCount} / ${total} 张图片${suffix}`);
  }

  function startForgeGenerationTimer(total) {
    forgeGenerationStartedAt = Date.now();
    forgeGenerationTotal = total;
    stopForgeGenerationTimer();
    forgeGenerationTimer = window.setInterval(() => {
      if (forgeGenerationRunning) {
        updateForgeGenerationProgressStatus("已生成");
      }
    }, 1000);
  }

  function stopForgeGenerationTimer() {
    if (forgeGenerationTimer) {
      window.clearInterval(forgeGenerationTimer);
      forgeGenerationTimer = null;
    }
  }

  function handleForgeImageGenerated(entry) {
    if (!entry || !entry.image) return;

    const index = Number.isInteger(entry.index) ? entry.index : 0;
    fillForgeImageSlot(index, entry.image);
    if (Number.isInteger(entry.total) && entry.total > 0) {
      forgeGenerationTotal = entry.total;
    }
    updateForgeGenerationProgressStatus("已生成");
    advanceOnboardingAfterGeneration();
  }

  function normalizeForgeImage(image, index) {
    if (typeof image === "string") {
      return {
        src: image,
        filePath: "",
        relativePath: "",
        label: `Forge 生成图 ${index + 1}`,
        meta: null
      };
    }

    const relativePath = typeof image?.relativePath === "string" ? image.relativePath : "";

    return {
      src: typeof image?.src === "string" && image.src ? image.src : normalizePreviewImageSrc(relativePath),
      filePath: typeof image?.filePath === "string" ? image.filePath : "",
      relativePath,
      label: `Forge 生成图 ${index + 1}`,
      meta: image?.meta || null
    };
  }

  function formatSelectedCards(selectedCards) {
    if (!Array.isArray(selectedCards) || selectedCards.length === 0) {
      return "未抽取提示词卡片";
    }

    const positiveCards = selectedCards
      .filter(card => card.target !== "negative")
      .map(card => formatCardSnapshotPrompt(card));
    const negativeCards = selectedCards
      .filter(card => card.target === "negative")
      .map(card => formatCardSnapshotPrompt(card));
    const parts = [];

    if (positiveCards.length > 0) {
      parts.push(`正向：${positiveCards.join(" / ")}`);
    }

    if (negativeCards.length > 0) {
      parts.push(`负向：${negativeCards.join(" / ")}`);
    }

    return parts.join("；");

    return selectedCards
      .map(card => `${card.target === "negative" ? "负" : "正"}:${formatCardSnapshotPrompt(card)}`)
      .join(" / ");
  }

  function formatCardSnapshotPrompt(card) {
    const prompt = String(card?.prompt || "").trim();
    const strength = clampPromptStrength(card?.strength ?? 1);

    if (hasLockedEmbeddedStrength(prompt)) {
      return prompt;
    }

    if (!prompt) return "空 prompt";

    if (hasAnglePrompt(prompt)) {
      return updateAnglePromptStrength(prompt, strength);
    }

    if (Math.abs(strength - 1) < 0.001) {
      return prompt;
    }

    return `(${prompt}:${formatPromptStrength(strength)})`;
  }

  function getCopiedImageSeed(meta) {
    const parseSeedValue = value => {
      if (typeof value === "string" && /Seed:/i.test(value)) {
        const match = value.match(/(?:^|[,;\n\r])\s*Seed:\s*(\d+)/i);
        if (match) {
          const seed = Number(match[1]);
          return Number.isFinite(seed) && seed >= 0 ? seed : NaN;
        }
      }

      const seed = Number(value);
      return Number.isFinite(seed) && seed >= 0 ? seed : NaN;
    };

    const info = meta?.generationInfo || meta?.info || {};
    const infotexts = Array.isArray(info?.infotexts) ? info.infotexts : [];
    const allSeeds = Array.isArray(info?.all_seeds) ? info.all_seeds : [];
    const candidates = [
      meta?.seed,
      meta?.actualSeed,
      allSeeds[0],
      info?.seed,
      infotexts[0],
      info?.infotext,
      meta?.infotext,
      meta?.parameters,
      meta?.requestedSeed,
      meta?.payload?.seed
    ].map(parseSeedValue);

    const seed = candidates.find(value => Number.isFinite(value) && value >= 0);
    return Number.isFinite(seed) ? Math.trunc(seed) : -1;
  }

  function createForgeImageCard(imageData, index, isPlaceholder = false) {
    const item = document.createElement("div");
    item.className = isPlaceholder ? "forge-image-item forge-image-placeholder" : "forge-image-item";
    item.dataset.index = String(index);

    if (isPlaceholder) {
      const label = document.createElement("div");
      label.className = "forge-placeholder-label";
      label.textContent = `等待生成 ${index + 1}`;
      item.appendChild(label);
      return item;
    }

    const image = document.createElement("img");
    image.onload = resetImageViewerTransform;
    image.src = imageData.src;
    image.alt = imageData.label;
    image.addEventListener("click", () => openImageViewer(
      imageData,
      currentForgeImages.filter(Boolean),
      index
    ));

    item.appendChild(image);
    return item;

    const actions = document.createElement("div");
    actions.className = "forge-image-actions";
    const reproduceButton = document.createElement("button");
    reproduceButton.type = "button";
    reproduceButton.textContent = "复制参数";
    reproduceButton.addEventListener("click", event => {
      event.stopPropagation();
      reproduceForgeImage(imageData);
    });
    const folderButton = document.createElement("button");
    folderButton.type = "button";
    folderButton.textContent = "文件夹";
    folderButton.disabled = !imageData.filePath;
    folderButton.addEventListener("click", event => {
      event.stopPropagation();
      openImageFolder(imageData.filePath);
    });
    actions.append(reproduceButton, folderButton);
    item.append(details, actions);
    return item;
  }

  function setForgeGalleryAspectRatio(width, height) {
    const gallery = document.getElementById("forgeImageGallery");
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);

    if (gallery) {
      gallery.style.setProperty("--forge-image-aspect-ratio", `${safeWidth} / ${safeHeight}`);
    }
  }

  function renderForgeImagePlaceholders(count, width, height) {
    const gallery = document.getElementById("forgeImageGallery");
    if (!gallery) return;

    gallery.replaceChildren();
    gallery.dataset.count = String(count);
    setForgeGalleryAspectRatio(width, height);
    currentForgeImages = new Array(count).fill(null);

    for (let index = 0; index < count; index += 1) {
      gallery.appendChild(createForgeImageCard(null, index, true));
    }
  }

  function fillForgeImageSlot(index, image) {
    const gallery = document.getElementById("forgeImageGallery");
    if (!gallery) return;

    const imageData = normalizeForgeImage(image, index);
    currentForgeImages[index] = imageData;
    addGenerationHistory(imageData);

    const existing = gallery.querySelector(`[data-index="${index}"]`);
    const nextItem = createForgeImageCard(imageData, index);

    if (existing) {
      existing.replaceWith(nextItem);
    } else {
      gallery.appendChild(nextItem);
    }
  }

  function renderForgeImages(images) {
    const gallery = document.getElementById("forgeImageGallery");
    if (!gallery) return;

    gallery.replaceChildren();
    gallery.dataset.count = String(Array.isArray(images) ? images.length : 0);

    if (!images || images.length === 0) {
      const empty = document.createElement("div");
      empty.className = "forge-empty-result";
      empty.textContent = "未返回图片";
      gallery.appendChild(empty);
      return;
    }

    images.forEach((entry, index) => {
      const imageData = normalizeForgeImage(entry, index);
      currentForgeImages[index] = imageData;
      gallery.appendChild(createForgeImageCard(imageData, index));
    });
  }

  function clearForgeImageResults() {
    if (forgeGenerationRunning) {
      alert("任务运行中，停止或完成后再清空结果。");
      return;
    }

    const gallery = document.getElementById("forgeImageGallery");
    if (!gallery) return;

    currentForgeImages = [];
    forgeGenerationStartedAt = 0;
    forgeGenerationTotal = 0;
    gallery.dataset.count = "0";
    gallery.replaceChildren();

    const empty = document.createElement("div");
    empty.className = "forge-empty-result";
    empty.textContent = "暂无图片";
    gallery.appendChild(empty);
    setForgeGenerateStatus("生成结果已清空。");
  }

  function addGenerationHistory(imageData) {
    if (!imageData || !imageData.src) return;

    const entry = {
      id: createId("history"),
      src: imageData.src,
      filePath: imageData.filePath || "",
      label: imageData.label || "生成图片",
      meta: imageData.meta || null
    };

    generationHistory = [entry, ...generationHistory.filter(item => item.src !== entry.src)].slice(0, HISTORY_LIMIT);
    saveGenerationHistory();
    renderGenerationHistory();
  }

  function renderGenerationHistory() {
    const list = document.getElementById("generationHistoryList");
    if (!list) return;

    list.replaceChildren();

    if (generationHistory.length === 0) {
      const empty = document.createElement("div");
      empty.className = "small-hint";
      empty.textContent = "暂无生成历史";
      list.appendChild(empty);
      return;
    }

    generationHistory.slice(0, HISTORY_LIMIT).forEach((entry, index) => {
      const item = document.createElement("div");
      item.className = "generation-history-item";
      item.title = entry.label || "查看图片详情";
      const image = document.createElement("img");
      image.src = entry.src;
      image.alt = "历史图片";
      item.appendChild(image);
      item.addEventListener("click", () => openImageViewer(entry, generationHistory.slice(0, HISTORY_LIMIT), index));
      list.appendChild(item);
    });
  }

  async function clearGenerationHistory() {
    const confirmed = await showConfirmDialog("确定清空生成历史吗？不会删除硬盘上的图片文件。", {
      okText: "清空"
    });
    if (!confirmed) return;

    generationHistory = [];
    saveGenerationHistory();
    renderGenerationHistory();
  }

  async function reproduceForgeImage(imageData) {
    const meta = imageData?.meta;
    if (!meta) {
      alert("这张图没有可复制的参数。");
      return;
    }

    setInputValue("forgeWidth", meta.width || 1024);
    setInputValue("forgeHeight", meta.height || 1536);
    setInputValue("forgeSeed", getCopiedImageSeed(meta));
    document.getElementById("taskCount").value = 1;
    const hiresInput = document.getElementById("forgeHiresFix");
    if (hiresInput) hiresInput.checked = Boolean(meta.hiresFix);
    setCheckboxValue("forgeADetailer", meta.adetailer);
    const copyResult = copySelectedCardsToOutputPools(meta.selectedCards);
    const copiedCardCount = copyResult.copied || 0;
    const skippedCardCount = copyResult.skipped || 0;
    const restoredCardCount = copyResult.restored || 0;

    closeImageViewer();
    switchAppPage("images");
    setForgeGenerateStatus(
      copiedCardCount > 0
        ? `已复制图片参数，并放入 ${copiedCardCount} 张提示词卡片。${restoredCardCount ? `补回 ${restoredCardCount} 张已删除卡片。` : ""}${skippedCardCount ? `跳过 ${skippedCardCount} 张无信息卡片。` : ""}你可以继续修改后手动生图。`
        : `已复制图片参数。${skippedCardCount ? `有 ${skippedCardCount} 张卡片缺少信息，无法恢复。` : "这张图没有记录到提示词卡片。"}你可以继续修改后手动生图。`
    );
    return;
    setForgeGenerateStatus(
      copiedCardCount > 0
        ? `已复制图片参数，并放入 ${copiedCardCount} 张提示词卡片。你可以继续修改后手动生图。`
        : "已复制图片参数。这张图没有记录到提示词卡片，你可以继续修改后手动生图。"
    );
    return;
    setForgeGenerateStatus("已复制图片参数。你可以继续修改参数或卡组，再手动点击“直接生图”。");
    return;

    switchAppPage("images");
    renderForgeImagePlaceholders(1, meta.width, meta.height);
    setForgeGenerationControls(true);
    startForgeGenerationTimer(1);
    setForgeGenerateStatus("正在生成图片...");

    try {
      const result = await window.forge.generateImage({
        items: [{
          prompt: meta.prompt || "",
          negativePrompt: meta.negativePrompt || "",
          width: meta.width || 1024,
          height: meta.height || 1536,
          seed: meta.seed ?? -1,
          hiresFix: Boolean(meta.hiresFix),
          adetailer: Boolean(meta.adetailer),
          adetailerPrompts: meta.adetailerPrompts || null,
          selectedCards: Array.isArray(meta.selectedCards) ? meta.selectedCards : []
        }]
      });

      if (currentForgeImages.filter(Boolean).length === 0 && Array.isArray(result.images)) {
        renderForgeImages(result.images);
      }
      setForgeGenerateStatus("生成任务完成。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setForgeGenerateStatus(message);
      alert(message);
    } finally {
      stopForgeGenerationTimer();
      setForgeGenerationControls(false);
    }
  }

  async function openTodayOutputFolder() {
    if (!window.forge?.openTodayOutputFolder) return;

    try {
      await window.forge.openTodayOutputFolder();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshForgeDefaults() {
    const info = document.getElementById("forgeDefaultsInfo");
    if (!info || !window.forge?.getDefaults) return;

    info.textContent = "读取中...";

    try {
      const defaults = await window.forge.getDefaults();
      currentForgeDefaults = defaults;
      info.innerHTML = `
        <div>模型：${escapeHtml(defaults.model || "未读取")}</div>
        <div>VAE：${escapeHtml(defaults.vae || "未读取")}</div>
        <div>采样器：${escapeHtml(defaults.samplerName || "-")} / 调度：${escapeHtml(defaults.scheduler || "Automatic")}</div>
        <div>步数：${escapeHtml(defaults.steps)} / CFG：${escapeHtml(defaults.cfgScale)} / Clip skip：${escapeHtml(defaults.clipSkip)}</div>
        <div>高清修复：${escapeHtml(defaults.hiresUpscaler || "-")}，倍率 ${escapeHtml(defaults.hiresScale)}，重绘 ${escapeHtml(defaults.hiresDenoisingStrength)}</div>
      `;
    } catch (error) {
      info.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  function updateImageViewerTransform() {
    const image = document.getElementById("imageViewerImage");
    if (!image) return;

    image.style.transform = `translate(${imageViewerState.x}px, ${imageViewerState.y}px) scale(${imageViewerState.scale})`;
  }

  function fitImageViewerImage() {
    const viewport = document.getElementById("imageViewerViewport");
    const image = document.getElementById("imageViewerImage");

    if (!viewport || !image || !image.naturalWidth || !image.naturalHeight) return;

    const bounds = viewport.getBoundingClientRect();
    const paddingX = 20;
    const paddingY = 20;
    const availableWidth = Math.max(1, bounds.width - paddingX);
    const availableHeight = Math.max(1, bounds.height - paddingY);
    const ratio = Math.min(
      availableWidth / image.naturalWidth,
      availableHeight / image.naturalHeight
    );

    image.style.width = `${Math.floor(image.naturalWidth * ratio)}px`;
    image.style.height = `${Math.floor(image.naturalHeight * ratio)}px`;
  }

  function resetImageViewerTransform() {
    fitImageViewerImage();
    imageViewerState = {
      ...imageViewerState,
      scale: 1,
      x: 0,
      y: 0,
      dragging: false
    };
    updateImageViewerTransform();
  }

  function normalizeImageViewerList(imageData, imageList, index) {
    const images = Array.isArray(imageList)
      ? imageList.map(normalizePoolPresetPreviewImage).filter(Boolean)
      : [];
    const fallbackImage = normalizePoolPresetPreviewImage(imageData);

    if (images.length === 0 && fallbackImage) {
      return { images: [fallbackImage], index: 0 };
    }

    const safeIndex = Math.max(0, Math.min(images.length - 1, Math.floor(Number(index) || 0)));
    return { images, index: safeIndex };
  }

  function updateImageViewerNavigationButtons() {
    const previousButton = document.getElementById("imageViewerPreviousButton");
    const nextButton = document.getElementById("imageViewerNextButton");
    const total = imageViewerState.images.length;
    const disabled = total <= 1;

    if (previousButton) previousButton.disabled = disabled;
    if (nextButton) nextButton.disabled = disabled;
  }

  function showImageViewerImageAt(index) {
    const viewer = document.getElementById("imageViewerOverlay");
    const image = document.getElementById("imageViewerImage");
    const title = document.getElementById("imageViewerTitle");
    const reproduceButton = document.getElementById("imageViewerReproduceButton");
    const folderButton = document.getElementById("imageViewerFolderButton");

    if (!viewer || !image) return;

    const total = imageViewerState.images.length;
    if (total === 0) return;
    const safeIndex = ((Math.floor(Number(index) || 0) % total) + total) % total;
    const imageData = imageViewerState.images[safeIndex];

    image.onload = resetImageViewerTransform;
    image.src = imageData.src;
    image.alt = imageData.label;
    imageViewerState.currentImage = imageData;
    imageViewerState.index = safeIndex;
    viewer.dataset.filePath = imageData.filePath || "";

    if (title) {
      title.textContent = total > 1
        ? `${imageData.label || "生成图片"} (${safeIndex + 1}/${total})`
        : imageData.label || "生成图片";
    }

    if (folderButton) {
      folderButton.disabled = !imageData.filePath;
    }

    if (reproduceButton) {
      reproduceButton.disabled = !imageData.meta;
    }

    renderImageViewerDetails(imageData);
    resetImageViewerTransform();
    updateImageViewerNavigationButtons();
  }

  function openImageViewer(imageData, imageList = null, index = 0) {
    const viewer = document.getElementById("imageViewerOverlay");
    if (!viewer || !imageData) return;

    const normalized = normalizeImageViewerList(imageData, imageList, index);
    if (normalized.images.length === 0) return;

    imageViewerState.images = normalized.images;
    imageViewerState.index = normalized.index;
    viewer.classList.remove("hidden");
    document.body.classList.add("viewer-open");
    showImageViewerImageAt(normalized.index);
  }

  function showPreviousImageViewerImage() {
    if (imageViewerState.images.length <= 1) return;
    showImageViewerImageAt(imageViewerState.index - 1);
  }

  function showNextImageViewerImage() {
    if (imageViewerState.images.length <= 1) return;
    showImageViewerImageAt(imageViewerState.index + 1);
  }

  function renderImageViewerDetails(imageData) {
    const details = document.getElementById("imageViewerDetails");
    if (!details) return;

    const meta = imageData?.meta || {};
    const payload = meta.payload || {};

    details.innerHTML = `
      <div class="image-viewer-detail-row">
        <strong>参数</strong>
        <span>${escapeHtml(`${meta.width || payload.width || "-"}x${meta.height || payload.height || "-"} / Seed ${meta.seed ?? payload.seed ?? "-"}`)}</span>
      </div>
      <div class="image-viewer-detail-row">
        <strong>正向 prompt</strong>
        <span>${escapeHtml(meta.prompt || payload.prompt || "空 prompt")}</span>
      </div>
      <div class="image-viewer-detail-row">
        <strong>负向 prompt</strong>
        <span>${escapeHtml(meta.negativePrompt || payload.negative_prompt || "空 prompt")}</span>
      </div>
      <div class="image-viewer-detail-row">
        <strong>高清修复</strong>
        <span>${meta.hiresFix ? "开启" : "关闭"}</span>
      </div>
      <div class="image-viewer-detail-row">
        <strong>ADetailer</strong>
        <span>${meta.adetailer ? "开启" : "关闭"}</span>
      </div>
      ${meta.adetailerPrompts?.face ? `
        <div class="image-viewer-detail-row">
          <strong>AD face</strong>
          <span>${escapeHtml(meta.adetailerPrompts.face)}</span>
        </div>
      ` : ""}
      ${meta.adetailerPrompts?.hand ? `
        <div class="image-viewer-detail-row">
          <strong>AD hand</strong>
          <span>${escapeHtml(meta.adetailerPrompts.hand)}</span>
        </div>
      ` : ""}
    `;
  }

  function closeImageViewer() {
    const viewer = document.getElementById("imageViewerOverlay");
    const image = document.getElementById("imageViewerImage");
    const details = document.getElementById("imageViewerDetails");

    if (viewer) {
      viewer.classList.add("hidden");
      viewer.dataset.filePath = "";
    }

    imageViewerState.currentImage = null;
    imageViewerState.images = [];
    imageViewerState.index = 0;
    updateImageViewerNavigationButtons();

    if (image) {
      image.onload = null;
      image.removeAttribute("src");
    }

    if (details) {
      details.replaceChildren();
    }

    document.body.classList.remove("viewer-open");
    resetImageViewerTransform();
  }

  async function openImageFolder(filePath) {
    if (!filePath || !window.forge?.openImageFolder) return;

    try {
      await window.forge.openImageFolder(filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendForgeLog({
        level: "error",
        message,
        timestamp: new Date().toISOString()
      });
      alert(message);
    }
  }

  function initializeImageViewer() {
    const viewer = document.getElementById("imageViewerOverlay");
    const viewport = document.getElementById("imageViewerViewport");
    const image = document.getElementById("imageViewerImage");
    const closeButton = document.getElementById("imageViewerCloseButton");
    const resetButton = document.getElementById("imageViewerResetButton");
    const previousButton = document.getElementById("imageViewerPreviousButton");
    const nextButton = document.getElementById("imageViewerNextButton");
    const reproduceButton = document.getElementById("imageViewerReproduceButton");
    const folderButton = document.getElementById("imageViewerFolderButton");

    if (!viewer || !viewport || !image) return;

    closeButton?.addEventListener("click", closeImageViewer);
    resetButton?.addEventListener("click", resetImageViewerTransform);
    previousButton?.addEventListener("click", showPreviousImageViewerImage);
    nextButton?.addEventListener("click", showNextImageViewerImage);
    reproduceButton?.addEventListener("click", () => reproduceForgeImage(imageViewerState.currentImage));
    folderButton?.addEventListener("click", () => openImageFolder(viewer.dataset.filePath || ""));

    viewer.addEventListener("mousedown", event => {
      if (event.target === viewer) {
        closeImageViewer();
      }
    });

    viewer.addEventListener("wheel", event => {
      event.preventDefault();
      const nextScale = imageViewerState.scale * (event.deltaY < 0 ? 1.12 : 0.88);
      imageViewerState.scale = Math.max(0.2, Math.min(8, nextScale));
      updateImageViewerTransform();
    }, { passive: false });

    image.addEventListener("mousedown", event => {
      event.preventDefault();
      imageViewerState.dragging = true;
      imageViewerState.pointerX = event.clientX;
      imageViewerState.pointerY = event.clientY;
      image.classList.add("dragging");
    });

    image.addEventListener("dblclick", resetImageViewerTransform);

    window.addEventListener("mousemove", event => {
      if (!imageViewerState.dragging) return;

      const dx = event.clientX - imageViewerState.pointerX;
      const dy = event.clientY - imageViewerState.pointerY;
      imageViewerState.x += dx;
      imageViewerState.y += dy;
      imageViewerState.pointerX = event.clientX;
      imageViewerState.pointerY = event.clientY;
      updateImageViewerTransform();
    });

    window.addEventListener("mouseup", () => {
      imageViewerState.dragging = false;
      image.classList.remove("dragging");
    });

    window.addEventListener("resize", () => {
      if (!imageViewerState.currentImage) return;
      resetImageViewerTransform();
    });

    window.addEventListener("keydown", event => {
      if (event.key === "Escape" && !viewer.classList.contains("hidden")) {
        closeImageViewer();
      }

      if (event.key === "ArrowLeft" && !viewer.classList.contains("hidden")) {
        event.preventDefault();
        showPreviousImageViewerImage();
      }

      if (event.key === "ArrowRight" && !viewer.classList.contains("hidden")) {
        event.preventDefault();
        showNextImageViewerImage();
      }
    });
  }

  let customPromptTasks = [];

  function closeCustomForgePromptDialog() {
    const dialog = document.getElementById("customPromptDialog");

    if (dialog) {
      dialog.classList.add("hidden");
      dialog.setAttribute("aria-hidden", "true");
    }

    customPromptTasks = [];
    releaseModalFocus();
  }

  async function openCustomForgePromptDialog() {
    const dialog = document.getElementById("customPromptDialog");
    const commandInput = document.getElementById("customTaskCommandInput");

    if (!dialog || !commandInput) return;

    const taskDefaults = await loadForgeTaskDefaults();
    const items = generateForgeTasks(taskDefaults);
    if (items.length === 0) return;

    customPromptTasks = items;
    commandInput.value = formatForgeTaskCommands(items);
    dialog.classList.remove("hidden");
    dialog.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      commandInput.focus();
      commandInput.setSelectionRange(0, 0);
    });
  }

  async function confirmCustomForgePromptGeneration() {
    const commandInput = document.getElementById("customTaskCommandInput");
    const items = tasksFromCommandText(commandInput?.value || "", customPromptTasks);

    if (items.length === 0) {
      alert("请填写至少一行任务命令。");
      return;
    }

    closeCustomForgePromptDialog();
    await runForgeImageTasks(items);
  }

  function copyCustomTaskCommands() {
    const commandInput = document.getElementById("customTaskCommandInput");
    copyText(commandInput?.value || "", "已复制任务命令。");
  }

  async function runForgeImageTasks(items) {
    if (!window.forge) return;

    setForgeGenerateStatus("正在发送到 Forge...");

    try {
      if (items.length === 0) return;

      const expectedImageCount = getForgeTasksImageCount(items) || items.length;
      renderForgeImagePlaceholders(expectedImageCount, items[0]?.width, items[0]?.height);
      switchAppPage("images");
      setForgeGenerationControls(true);
      startForgeGenerationTimer(expectedImageCount);
      updateForgeGenerationProgressStatus("正在生成");
      const result = await window.forge.generateImage({ items });
      const generatedCount = currentForgeImages.filter(Boolean).length;

      if (generatedCount === 0 && Array.isArray(result.images)) {
        renderForgeImages(result.images);
      }

      const resultImageCount = Array.isArray(result.images) ? result.images.length : 0;
      const finalCount = Math.max(generatedCount, resultImageCount);
      const elapsedText = getForgeGenerationElapsedText();
      const suffix = elapsedText ? ` · ${elapsedText}` : "";
      advanceOnboardingAfterGeneration();

      setForgeGenerateStatus(result.canceled
        ? `任务已停止，已生成 ${currentForgeImages.filter(Boolean).length} 张图片${suffix}`
        : `生成完成：${finalCount} 张图片${suffix}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setForgeGenerateStatus(message);
      appendForgeLog({
        level: "error",
        message,
        timestamp: new Date().toISOString()
      });
      alert(message);
    } finally {
      stopForgeGenerationTimer();
      setForgeGenerationControls(false);
    }
  }

  async function generateForgeImage() {
    const taskDefaults = await loadForgeTaskDefaults();
    await runForgeImageTasks(generateForgeTasks(taskDefaults));
  }

  async function stopForgeGeneration() {
    if (!window.forge?.cancelGeneration || !forgeGenerationRunning) return;

    if (String(previewGeneratingCardId || "").startsWith("category:")) {
      previewBatchCancelRequested = true;
    }

    setForgeGenerateStatus("正在停止任务...");

    try {
      await window.forge.cancelGeneration();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendForgeLog({
        level: "error",
        message,
        timestamp: new Date().toISOString()
      });
      alert(message);
    }
  }

  async function pauseForgeGeneration() {
    if (!window.forge?.pauseGeneration || !forgeGenerationRunning || forgeGenerationPaused) return;

    try {
      await window.forge.pauseGeneration();
      forgeGenerationPaused = true;
      setForgeGenerationControls(true);
      setForgeGenerateStatus("队列已暂停，当前图片完成后会停在下一张之前。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendForgeLog({
        level: "error",
        message,
        timestamp: new Date().toISOString()
      });
      alert(message);
    }
  }

  async function resumeForgeGeneration() {
    if (!window.forge?.resumeGeneration || !forgeGenerationRunning || !forgeGenerationPaused) return;

    try {
      await window.forge.resumeGeneration();
      forgeGenerationPaused = false;
      setForgeGenerationControls(true);
      updateForgeGenerationProgressStatus("继续生成");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendForgeLog({
        level: "error",
        message,
        timestamp: new Date().toISOString()
      });
      alert(message);
    }
  }

  async function skipCurrentForgeGeneration() {
    if (!window.forge?.skipCurrentGeneration || !forgeGenerationRunning) return;

    try {
      await window.forge.skipCurrentGeneration();
      setForgeGenerateStatus("正在跳过当前图片，随后继续下一个任务。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendForgeLog({
        level: "error",
        message,
        timestamp: new Date().toISOString()
      });
      alert(message);
    }
  }

  async function checkForgeApi() {
    if (!window.forge) return;

    try {
      await window.forge.checkApi();
    } catch (error) {
      appendForgeLog({
        level: "error",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  }

  async function openForgeWebUi() {
    if (!window.forge?.openWebUi) return;

    try {
      await window.forge.openWebUi();
    } catch (error) {
      appendForgeLog({
        level: "error",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  }

  function initializeLibraryControls() {
    const categoryNameInput = document.getElementById("activeCategoryNameInput");
    if (categoryNameInput) {
      categoryNameInput.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          saveActiveCategoryName();
          categoryNameInput.blur();
        }
      });
      categoryNameInput.addEventListener("blur", saveActiveCategoryName);
    }

    const editPanel = document.getElementById("editCardPanel");
    const editDialog = editPanel ? editPanel.querySelector(".edit-card-dialog") : null;

    if (editPanel) {
      editPanel.addEventListener("mousedown", event => {
        if (event.target === editPanel) {
          cancelEditCard();
        }
      });
    }

    if (editDialog) {
      ["mousedown", "mouseup", "click", "mousemove"].forEach(eventName => {
        editDialog.addEventListener(eventName, event => {
          event.stopPropagation();
        });
      });

      editDialog.querySelectorAll("input, textarea, select, button").forEach(control => {
        control.addEventListener("mousedown", event => {
          event.stopPropagation();
        });
      });
    }

    const textCardDialog = document.getElementById("textCardDialog");
    const textCardBox = textCardDialog ? textCardDialog.querySelector(".text-card-dialog-box") : null;
    const textCardCancel = document.getElementById("textCardDialogCancel");
    const textCardCreate = document.getElementById("textCardDialogCreate");
    const categoryBatchDialog = document.getElementById("categoryBatchDialog");
    const categoryBatchBox = categoryBatchDialog ? categoryBatchDialog.querySelector(".category-batch-dialog-box") : null;
    const categoryBatchClose = document.getElementById("categoryBatchDialogClose");
    const categoryBatchSort = document.getElementById("categoryBatchSortButton");
    const poolPresetDialog = document.getElementById("poolPresetDialog");
    const poolPresetBox = poolPresetDialog ? poolPresetDialog.querySelector(".pool-preset-dialog-box") : null;
    const poolPresetClose = document.getElementById("poolPresetDialogClose");
    const poolPresetAddCategory = document.getElementById("poolPresetAddCategoryButton");
    const poolPresetRenameCategory = document.getElementById("poolPresetRenameCategoryButton");
    const poolPresetDeleteCategory = document.getElementById("poolPresetDeleteCategoryButton");
    const poolPresetSave = document.getElementById("poolPresetSaveButton");
    const poolPresetLoad = document.getElementById("poolPresetLoadButton");
    const poolPresetOverwrite = document.getElementById("poolPresetOverwriteButton");
    const poolPresetRename = document.getElementById("poolPresetRenameButton");
    const poolPresetDelete = document.getElementById("poolPresetDeleteButton");
    const customPromptDialog = document.getElementById("customPromptDialog");
    const customPromptBox = customPromptDialog ? customPromptDialog.querySelector(".custom-prompt-dialog-box") : null;
    const customPromptCancel = document.getElementById("customPromptDialogCancel");
    const customPromptCopy = document.getElementById("customPromptDialogCopy");
    const customPromptGenerate = document.getElementById("customPromptDialogGenerate");

    textCardCancel?.addEventListener("click", closeTextCardGenerator);
    textCardCreate?.addEventListener("click", confirmTextCardGenerator);
    categoryBatchSort?.addEventListener("click", sortCategoryBatchDialogCards);
    categoryBatchClose?.addEventListener("click", closeCategoryBatchDialog);
    poolPresetClose?.addEventListener("click", closePoolPresetPage);
    poolPresetAddCategory?.addEventListener("click", addPoolPresetCategory);
    poolPresetRenameCategory?.addEventListener("click", renamePoolPresetCategory);
    poolPresetDeleteCategory?.addEventListener("click", deletePoolPresetCategory);
    poolPresetSave?.addEventListener("click", saveCurrentPoolPreset);
    poolPresetLoad?.addEventListener("click", loadSelectedPoolPreset);
    poolPresetOverwrite?.addEventListener("click", overwriteSelectedPoolPreset);
    poolPresetRename?.addEventListener("click", renameSelectedPoolPreset);
    poolPresetDelete?.addEventListener("click", deleteSelectedPoolPreset);
    customPromptCancel?.addEventListener("click", closeCustomForgePromptDialog);
    customPromptCopy?.addEventListener("click", copyCustomTaskCommands);
    customPromptGenerate?.addEventListener("click", confirmCustomForgePromptGeneration);

    if (textCardDialog) {
      textCardDialog.addEventListener("mousedown", event => {
        if (event.target === textCardDialog) {
          closeTextCardGenerator();
        }
      });
    }

    if (textCardBox) {
      ["mousedown", "mouseup", "click", "mousemove"].forEach(eventName => {
        textCardBox.addEventListener(eventName, event => {
          event.stopPropagation();
        });
      });
    }

    if (categoryBatchDialog) {
      categoryBatchDialog.addEventListener("mousedown", event => {
        if (event.target === categoryBatchDialog) {
          closeCategoryBatchDialog();
        }
      });
    }

    if (categoryBatchBox) {
      ["mousedown", "mouseup", "click", "mousemove"].forEach(eventName => {
        categoryBatchBox.addEventListener(eventName, event => {
          event.stopPropagation();
        });
      });
    }

    if (poolPresetDialog) {
      poolPresetDialog.addEventListener("mousedown", event => {
        if (event.target === poolPresetDialog) {
          closePoolPresetPage();
        }
      });
    }

    if (poolPresetBox) {
      ["mousedown", "mouseup", "click", "mousemove"].forEach(eventName => {
        poolPresetBox.addEventListener(eventName, event => {
          event.stopPropagation();
        });
      });
    }

    if (customPromptDialog) {
      customPromptDialog.addEventListener("mousedown", event => {
        if (event.target === customPromptDialog) {
          closeCustomForgePromptDialog();
        }
      });
    }

    if (customPromptBox) {
      ["mousedown", "mouseup", "click", "mousemove"].forEach(eventName => {
        customPromptBox.addEventListener(eventName, event => {
          event.stopPropagation();
        });
      });
    }

    window.addEventListener("keydown", event => {
      if (event.key === "Escape" && textCardDialog && !textCardDialog.classList.contains("hidden")) {
        closeTextCardGenerator();
      }

      if (event.key === "Escape" && categoryBatchDialog && !categoryBatchDialog.classList.contains("hidden")) {
        closeCategoryBatchDialog();
      }

      if (event.key === "Escape" && poolPresetDialog && !poolPresetDialog.classList.contains("hidden")) {
        closePoolPresetPage();
      }

      if (event.key === "Escape" && customPromptDialog && !customPromptDialog.classList.contains("hidden")) {
        closeCustomForgePromptDialog();
      }
    });
  }

  window.onload = async function () {
    applyBackgroundImages();
    initializeLibraryControls();
    await loadInitialDefaultBackup();
    ensureActiveCategoryId();
    refreshCategorySelects();
    renderLibrary();
    renderOutputPools();
    refreshLibrarySelect();
    generatePrompt();
    updateLibraryVisibilityUi();
    initializeForgeDimensionInputs();
    initializeForgeSeedInputLimit();
    initializeImageViewer();
    renderGenerationHistory();
    initializeForgePanel();
    refreshForgeDefaults();
    initializeOnboardingGuide();
  };
