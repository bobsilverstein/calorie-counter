const versionNumber = "__APP_VERSION__";

function updateVersionLabel() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yyyy = now.getFullYear();

  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const time = `${hours}:${minutes} ${ampm}`;

  const fullVersion = `${versionNumber} ${mm}/${dd}/${yyyy} ${time}`;

  document.getElementById("versionLabel").textContent = fullVersion;
  document.getElementById("pageTitle").textContent =
    `Calorie Counter — ${fullVersion}`;
}

updateVersionLabel();

if ("serviceWorker" in navigator) {
  // Kill all existing SWs
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister());
  });

  // Block all future SW registrations
  navigator.serviceWorker.register = () => Promise.resolve(null);
}

document.addEventListener("DOMContentLoaded", () => {
  const db = firebase.firestore();

  // Offline persistence: cached reads + queued writes that sync on reconnect.
  // Must run before any query. Fails harmlessly on multi-tab (failed-precondition)
  // or unsupported browsers (unimplemented) — app simply behaves online-only.
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

  // refs
  const viewLog = document.getElementById("view-log");
  const viewAdd = document.getElementById("view-add");
  const viewFoods = document.getElementById("view-foods");

  const navLog = document.getElementById("navLog");
  const navAdd = document.getElementById("navAdd");
  const navFoods = document.getElementById("navFoods");

  const dayName = document.getElementById("dayName");
  const dayDate = document.getElementById("dayDate");
  const totalCalories = document.getElementById("totalCalories");
  const mealsList = document.getElementById("mealsList");

  const prevDay = document.getElementById("prevDay");
  const nextDay = document.getElementById("nextDay");
  const todayButton = document.getElementById("todayButton");

  // log inputs
  const tefillinCheckbox = document.getElementById("tefillinCheckbox");
  const tefillinComment = document.getElementById("tefillinComment");
  const tefillinClear = document.getElementById("tefillinClear");
  const tefillinMic = document.getElementById("tefillinMic");

  const weightValue = document.getElementById("weightValue");
  const weightClear = document.getElementById("weightClear");
  const weightMic = document.getElementById("weightMic");

  const exerciseComment = document.getElementById("exerciseComment");
  const exerciseClear = document.getElementById("exerciseClear");
  const exerciseMic = document.getElementById("exerciseMic");

  const logClear = document.getElementById("logClear");
  const logSave = document.getElementById("logSave");

  // add view
  const addSearch = document.getElementById("addSearch");
  const addSearchMic = document.getElementById("addSearchMic");
  const addResults = document.getElementById("addResults");
  const addFoodName = document.getElementById("addFoodName");
  const addComment = document.getElementById("addComment");
  const addCalories = document.getElementById("addCalories");
  const addServingSize = document.getElementById("addServingSize");
  const addServingMic = document.getElementById("addServingMic");
  const addCalLabel = document.getElementById("addCalLabel");
  const addTotal = document.getElementById("addTotal");
  const addClear = document.getElementById("addClear");
  const addSave = document.getElementById("addSave");

  // foods view
  const foodsSearch = document.getElementById("foodsSearch");
  const foodsSearchMic = document.getElementById("foodsSearchMic");
  const foodsList = document.getElementById("foodsList");
  const foodsFoodName = document.getElementById("foodsFoodName");
  const foodsComment = document.getElementById("foodsComment");
  const foodsCalories = document.getElementById("foodsCalories");
  const foodsServingSize = document.getElementById("foodsServingSize");
  const foodsUnit = document.getElementById("foodsUnit");
  const foodsPerUnit = document.getElementById("foodsPerUnit");
  const foodsClear = document.getElementById("foodsClear");
  const foodsSave = document.getElementById("foodsSave");
  const foodsUnitG = document.getElementById("foodsUnitG");
  const foodsUnitEach = document.getElementById("foodsUnitEach");

  const versionLabel = document.getElementById("versionLabel");

  // UPC scanner refs
  const scanUpcBtn  = document.getElementById("scanUpcBtn");
  const upcModal    = document.getElementById("upcModal");
  const upcCloseBtn = document.getElementById("upcCloseBtn");
  const upcVideo    = document.getElementById("upcVideo");

  // Shabbat info refs
  const shabbatInfo    = document.getElementById("shabbatInfo");
  const shabbatCandles = document.getElementById("shabbatCandles");
  const shabbatParsha  = document.getElementById("shabbatParsha");

  // state
  let currentDate = new Date();
  let currentMeal = "breakfast";
  let foodsCache = [];
  let suppressSave = false;

  const dNamesFull = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const mNamesFull = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const MEALS = ["breakfast","lunch","snack","dinner"];

  const fmt = d => d.toISOString().split("T")[0];
  const isToday = d => fmt(d) === fmt(new Date());

  // location for Shabbat times (Elk Grove Village, IL)
  const SHABBAT_LAT = 42.0039;
  const SHABBAT_LON = -87.9703;

  // UPC scanner state
  let upcStream = null;
  let upcScanning = false;
  let upcDetector = null;

  function stopUpcCamera(){
    upcScanning = false;
    if (upcStream){
      upcStream.getTracks().forEach(t => t.stop());
      upcStream = null;
    }
  }

  function closeUpcModal(){
    upcModal.classList.add("hidden");
    stopUpcCamera();
  }

  async function openUpcScanner(){
    if (!("BarcodeDetector" in window)){
      return;
    }
    try {
      upcDetector = new BarcodeDetector({
        formats: ["ean_13","ean_8","upc_a","upc_e"]
      });
      upcStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      upcVideo.srcObject = upcStream;
      upcModal.classList.remove("hidden");
      upcScanning = true;
      requestAnimationFrame(upcScanLoop);
    } catch {}
  }

  async function upcScanLoop(){
    if (!upcScanning) return;
    try {
      const codes = await upcDetector.detect(upcVideo);
      if (codes.length > 0){
        const upc = codes[0].rawValue;
        upcScanning = false;
        await handleUpc(upc);
        closeUpcModal();
        return;
      }
    } catch {}
    requestAnimationFrame(upcScanLoop);
  }

  async function handleUpc(upc){
    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(upc)}.json`
      );
      const data = await res.json();
      if (data.status !== 1){
        alert("UPC not found.");
        return;
      }

      const p = data.product || {};
      const n = p.nutriments || {};

      addFoodName.value = p.product_name || p.generic_name || "";
      addComment.value = [p.brands || "", p.quantity || ""]
        .filter(Boolean).join(" • ");

      let size = 0;
      let unit = "g";

      if (p.serving_size){
        const m = p.serving_size.match(/([\d.,]+)\s*(\w+)?/i);
        if (m){
          size = Number(m[1].replace(",", ".")) || 0;
          const u = (m[2] || "").toLowerCase();
          if (u.startsWith("g")) unit = "g";
          else if (u.startsWith("pc") || u.startsWith("piece")) unit = "each";
        }
      }

      if (!size){
        size = 100;
        unit = "g";
      }

      let calServing =
        n["energy-kcal_serving"] ||
        n["energy-kcal"] ||
        n["energy-kcal_100g"] || 0;
      calServing = Number(calServing) || 0;

      if (unit === "g"){
        addCalLabel.textContent = "Calories per gram";
        addServingSize.value = size;
        addCalories.value = size ? Math.round(calServing / size) : "";
      } else {
        addCalLabel.textContent = "Calories per piece";
        addServingSize.value = 1;
        addCalories.value = Math.round(calServing);
      }

      updateAddTotal();
    } catch {
      alert("Error reading UPC.");
    }
  }

  function micAuto(input, btn) {
    input.addEventListener("focus", () => startMic(input, btn));
  }
  function startMic(target, btn) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    btn.textContent = "🎙️";
    r.lang = "en-US";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = e => {
      target.value = e.results[0][0].transcript;

      if (target === addSearch) {
        runAddSearch();
      } else if (target === foodsSearch) {
        runFoodsSearch();
      }

      target.dispatchEvent(new Event("blur"));
    };
    r.onend = () => btn.textContent = "🎤";
    r.start();
  }

  [
    [tefillinComment,tefillinMic],
    [weightValue,weightMic],
    [exerciseComment,exerciseMic],
    [addSearch,addSearchMic],
    [addServingSize,addServingMic],
    [foodsSearch,foodsSearchMic]
  ].forEach(([i,b])=>micAuto(i,b));

  tefillinClear.onclick = () => { tefillinComment.value=""; saveNotes(); };
  weightClear.onclick   = () => { weightValue.value=""; saveNotes(); };
  exerciseClear.onclick = () => { exerciseComment.value=""; saveNotes(); };

  addClear.onclick = () => {
    addFoodName.value="";
    addComment.value="";
    addCalories.value="";
    addServingSize.value="";
    addSearch.value="";
    addResults.innerHTML="";
    addTotal.value="";
  };

  logClear.onclick = () => {
    tefillinComment.value="";
    exerciseComment.value="";
    weightValue.value="";
    tefillinCheckbox.checked=false;
  };

  function showView(v){
    viewLog.classList.add("hidden");
    viewAdd.classList.add("hidden");
    viewFoods.classList.add("hidden");
    if(v==="log") viewLog.classList.remove("hidden");
    if(v==="add") viewAdd.classList.remove("hidden");
    if(v==="foods") viewFoods.classList.remove("hidden");
  }

  function pushView(v){
    history.pushState({view:v},"");
    showView(v);
  }

  window.onpopstate = () => showView(history.state?.view || "log");

  navLog.onclick  = () => pushView("log");
  navAdd.onclick  = () => pushView("add");
  navFoods.onclick= () => pushView("foods");

  document.querySelectorAll(".meal-toggle").forEach(b=>{
    b.onclick = () => {
      currentMeal = b.dataset.meal;
      document.querySelectorAll(".meal-toggle").forEach(x=>{
        x.style.backgroundColor = "white";
      });
      b.style.backgroundColor = "#dbeafe";
    };
  });

  async function isJewishHoliday(gDate){
    const y = gDate.getFullYear();
    const m = gDate.getMonth() + 1;
    const d = gDate.getDate();

    const url = `https://www.hebcal.com/converter?cfg=json&gy=${y}&gm=${m}&gd=${d}&g2h=1`;

    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!data.events) return false;

      const yomTovList = [
        "Rosh Hashana",
        "Yom Kippur",
        "Sukkot",
        "Shemini Atzeret",
        "Simchat Torah",
        "Pesach",
        "Shavuot"
      ];

      return data.events.some(ev =>
        yomTovList.some(name => ev.includes(name))
      );
    } catch {
      return false;
    }
  }

  function applyTefillinDisable(shabbat, yomTov){
    // On Shabbos/Yom Tov disable ONLY the checkbox; the comment box, its clear
    // button, and the mic stay active (issue #9).
    const block = shabbat || yomTov;
    tefillinCheckbox.disabled = block;
    tefillinCheckbox.classList.toggle("opacity-40", block);
    if (block) tefillinCheckbox.checked = false;

    tefillinComment.disabled = false;
    tefillinClear.disabled = false;
    tefillinMic.disabled = false;
    tefillinComment.classList.remove("opacity-40");
    tefillinClear.classList.remove("opacity-40");
    tefillinMic.classList.remove("opacity-40");
  }

 async function loadShabbatInfo(date){
  if (date.getDay() !== 5){
    if (shabbatInfo) shabbatInfo.classList.add("hidden");
    return;
  }

  if (!shabbatInfo || !shabbatCandles || !shabbatParsha) return;

  const key = fmt(date);
  const url = `https://www.hebcal.com/shabbat?cfg=json&geo=pos&latitude=${SHABBAT_LAT}&longitude=${SHABBAT_LON}&start=${key}&end=${key}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const items = data.items || [];

    const candles = items.find(i => i.category === "candles");
    const parsha  = items.find(i => i.category === "parashat");

    shabbatCandles.textContent =
      candles
        ? `Candle lighting (${data.location?.title || "Location"}): ${candles.title}`
        : "";

    shabbatParsha.textContent =
      parsha
        ? `Parsha: ${parsha.hebrew} / ${parsha.title}`
        : "";

    if (!shabbatCandles.textContent && !shabbatParsha.textContent){
      shabbatInfo.classList.add("hidden");
    } else {
      shabbatInfo.classList.remove("hidden");
    }
  } catch {
    shabbatInfo.classList.add("hidden");
  }
}


  function renderDate(){
    suppressSave = true;

    const d = currentDate;
    dayName.textContent = dNamesFull[d.getDay()];
    dayDate.textContent =
      `${mNamesFull[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    nextDay.classList.remove("invisible"); // forward arrow always visible (issue #8)
    todayButton.style.display = isToday(d) ? "none" : "inline-block";
    loadLog();
    loadNotes();
    loadShabbatInfo(d);

    suppressSave = false;
  }

  prevDay.onclick = () => {
    currentDate.setDate(currentDate.getDate() - 1);
    renderDate();
  };

  nextDay.onclick = () => {
    currentDate.setDate(currentDate.getDate() + 1);
    renderDate();
  };

  todayButton.onclick = () => {
    currentDate = new Date();
    renderDate();
    pushView("log");
  };

  // foods
  function loadFoods(){
    db.collection("Foods").onSnapshot(s=>{
      foodsCache = s.docs.map(d=>({id:d.id, ...d.data()}));
      runFoodsSearch();
    });
  }

  function match(f,q){
    return (f.Food||"").toLowerCase().includes(q) ||
           (f.Comment||"").toLowerCase().includes(q);
  }

  function runFoodsSearch(){
    const q = foodsSearch.value.toLowerCase();
    const list = q ? foodsCache.filter(f=>match(f,q)) : [];
    foodsList.innerHTML = "";
    list.forEach(f=>{
      const b = document.createElement("button");
      b.className = "w-full text-left p-2 border-b border-blue-200 cursor-pointer";
      b.innerHTML = `
        <div class="font-medium">${f.Food}</div>
        <div class="text-xs text-blue-700">${f.Comment || ""}</div>
        <div class="text-xs text-blue-700">${f.CaloriesPerServing} cal/${f.Unit}</div>
      `;
      b.onclick = () => {
        loadFoodEditor(f);
        foodsSearch.value = "";
        foodsList.innerHTML = "";
      };
      foodsList.appendChild(b);
    });
  }

  foodsSearch.oninput = runFoodsSearch;

  function loadFoodEditor(f){
    foodsFoodName.value = f.Food;
    foodsComment.value  = f.Comment || "";

    foodsUnit.value = f.Unit || "g";

    foodsUnitG.style.backgroundColor =
      (foodsUnit.value === "g") ? "#dbeafe" : "white";
    foodsUnitEach.style.backgroundColor =
      (foodsUnit.value === "each") ? "#dbeafe" : "white";

    foodsCalories.value = f.CaloriesPerServing || 0;
    foodsServingSize.value = f.ServingSize || 1;

    const cal = Number(foodsCalories.value) || 0;
    const s   = Number(foodsServingSize.value) || 0;
    foodsPerUnit.value = s ? (cal / s).toFixed(2) : "";
  }

  // add search
  function runAddSearch(){
    const q = addSearch.value.toLowerCase();
    const list = q ? foodsCache.filter(f=>match(f,q)) : [];
    addResults.innerHTML = "";
    list.forEach(f=>{
      const b = document.createElement("button");
      b.className = "w-full text-left p-2 border-b border-blue-200 cursor-pointer";
      b.innerHTML = `
        <div class="font-medium">${f.Food}</div>
        <div class="text-xs text-blue-700">${f.Comment || ""}</div>
        <div class="text-xs text-blue-700">${f.CaloriesPerServing} cal/${f.Unit}</div>
      `;
      b.onclick = () => {
        addFoodName.value = f.Food;
        addComment.value  = f.Comment || "";
        addCalories.value = f.CaloriesPerServing;
        addCalLabel.textContent =
          f.Unit === "g" ? "Calories per gram" : "Calories per piece";
        addServingSize.value = "";
        addSearch.value = "";
        addResults.innerHTML = "";
        updateAddTotal();
      };
      addResults.appendChild(b);
    });
  }

  addSearch.oninput = runAddSearch;

  // calc total (serving calories, integer)
  function updateAddTotal(){
    const cal = Number(addCalories.value) || 0;
    const s   = Number(addServingSize.value) || 0;
    const t   = cal * s;
    addTotal.value = s ? Math.round(t) : "";
  }

  addServingSize.oninput = updateAddTotal;

  // foods per-unit calculator (2 decimals)
  function updateFoodsPerUnit(){
    const cal = Number(foodsCalories.value) || 0;
    const s   = Number(foodsServingSize.value) || 0;
    const per = s ? cal / s : 0;
    foodsPerUnit.value = s ? per.toFixed(2) : "";
  }

  foodsCalories.oninput    = updateFoodsPerUnit;
  foodsServingSize.oninput = updateFoodsPerUnit;
  foodsUnit.onchange       = updateFoodsPerUnit;

  // save serving
  addSave.onclick = async () => {
    const name = addFoodName.value.trim();
    if (!name) return;

    const cal  = Number(addCalories.value) || 0; // per unit
    const s    = Number(addServingSize.value) || 0;
    const t    = cal * s;
    const unit = addCalLabel.textContent.includes("gram") ? "g" : "each";

    await db.collection("Logs").doc(fmt(currentDate))
      .collection(currentMeal).add({
        Food: name,
        Comment: addComment.value.trim(),
        CaloriesPerServing: cal,
        ServingSize: s,
        TotalCalories: Math.round(t),
        Unit: unit,
        Timestamp: Date.now()
      });

    pushView("log");
    loadLog();
  };

  // save notes
  logSave.onclick = saveNotes;

  async function saveNotes(){
    if (suppressSave) return;
    await db.collection("DailyNotes").doc(fmt(currentDate)).set({
      Tefillin: tefillinCheckbox.checked,
      TefillinComment: tefillinComment.value.trim(),
      WeightValue: weightValue.value === "" ? null : Number(weightValue.value),
      ExerciseComment: exerciseComment.value.trim(),
      Timestamp: Date.now()
    }, {merge:true});
  }

  async function loadNotes(){
    const s = await db.collection("DailyNotes").doc(fmt(currentDate)).get();
    const d = s.exists ? s.data() : {};

    tefillinCheckbox.checked = !!d.Tefillin;
    tefillinComment.value    = d.TefillinComment || "";
    exerciseComment.value    = d.ExerciseComment || "";
    weightValue.value        = d.WeightValue != null ? d.WeightValue : "";
  }

  // log
  async function loadLog(){
    const key = fmt(currentDate);

    const shabbat = currentDate.getDay() === 6;
    const yomTov  = await isJewishHoliday(currentDate);
    applyTefillinDisable(shabbat, yomTov);

    mealsList.innerHTML = "";
    let total = 0;

    for (const meal of MEALS){
      const s = await db.collection("Logs").doc(key).collection(meal)
        .orderBy("Timestamp").get();

      const entries = s.docs.map(d=>({id:d.id, ...d.data()}));
      const mealTotal = entries.reduce((a,e)=>a+(e.TotalCalories||0),0);
      total += mealTotal;

      const sec = document.createElement("div");
      sec.className = "border border-blue-300 rounded p-2";

      const head = document.createElement("div");
      head.className = "flex justify-between items-center cursor-pointer";
      head.innerHTML = `
        <div class="font-semibold text-blue-700">
          ${meal.charAt(0).toUpperCase()+meal.slice(1)} Servings
        </div>
        <div class="text-sm text-blue-700">${mealTotal} cal</div>
      `;

      const body = document.createElement("div");
      body.className = "mt-2 space-y-2";

      entries.forEach(e=>{
        const row = document.createElement("div");
        row.className =
          "flex justify-between items-baseline border-b border-blue-200 pb-1 text-sm";
        row.innerHTML = `
          <div class="flex-1 truncate">
            <span class="font-medium">${e.Food}</span>
            <span class="text-blue-700">
              ${e.Comment ? ` – ${e.Comment}` : ""}
              ${e.ServingSize ? ` – ${e.ServingSize}` : ""}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-16 text-right font-bold text-blue-700">
              ${e.TotalCalories} cal
            </div>
            <button class="text-red-600 font-bold text-lg cursor-pointer"
                    data-id="${e.id}" data-meal="${meal}">
              ✕
            </button>
          </div>
        `;
        body.appendChild(row);
      });

      head.onclick = () => {
        pushView("add");
        currentMeal = meal;
        document.querySelectorAll(".meal-toggle").forEach(b=>{
          b.style.backgroundColor = "white";
          if (b.dataset.meal === meal)
            b.style.backgroundColor = "#dbeafe";
        });
      };

      sec.appendChild(head);
      sec.appendChild(body);
      mealsList.appendChild(sec);
    }

    mealsList.querySelectorAll("button[data-id]").forEach(btn=>{
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const meal = btn.dataset.meal;
        await db.collection("Logs")
          .doc(fmt(currentDate))
          .collection(meal)
          .doc(id)
          .delete();
        loadLog();
      };
    });

    totalCalories.textContent = `${total} calories`;

    const banner = document.querySelector("div[style*='height:110px']");
    if (banner){
      banner.style.backgroundColor =
        total >= 2000 ? "#dc2626" :
        total >= 1800 ? "#facc15" :
        "#1d4ed8";
    }
  }

  // most recent weight
  async function loadMostRecentWeight(){
    const s = await db.collection("DailyNotes")
      .orderBy("Timestamp","desc").limit(1).get();
    if (!s.empty){
      const w = s.docs[0].data().WeightValue;
      if (w != null) weightValue.value = w;
    }
  }

  // foods clear/save
  foodsClear.onclick = () => {
    foodsFoodName.value="";
    foodsComment.value="";
    foodsCalories.value="";
    foodsServingSize.value="";
    foodsUnit.value="g";
    foodsPerUnit.value="";
    foodsUnitG.style.backgroundColor = "#dbeafe";
    foodsUnitEach.style.backgroundColor = "white";
  };

  foodsUnitG.onclick = () => {
    foodsUnit.value = "g";
    foodsUnitG.style.backgroundColor = "#dbeafe";
    foodsUnitEach.style.backgroundColor = "white";
    updateFoodsPerUnit();
  };

  foodsUnitEach.onclick = () => {
    foodsUnit.value = "each";
    foodsUnitEach.style.backgroundColor = "#dbeafe";
    foodsUnitG.style.backgroundColor = "white";
    updateFoodsPerUnit();
  };

  foodsSave.onclick = async () => {
    const name = foodsFoodName.value.trim();
    if (!name) return;

    const cal  = Number(foodsCalories.value) || 0;
    const s    = Number(foodsServingSize.value) || 0;
    const unit = foodsUnit.value;

    const perUnit = s ? cal / s : 0;

    await db.collection("Foods").doc().set({
      Food: name,
      Comment: foodsComment.value.trim(),
      CaloriesPerServing: Math.round(perUnit),
      Unit: unit,
      ServingSize: s
    });
  };

  // XLSX backup download
  document.getElementById("downloadBackup").onclick = downloadBackup;

  async function downloadBackup(){
    const key = fmt(new Date());

    const foodsDoc = await db.collection("Backups").doc(key)
      .collection("Foods").doc("data").get();
    const foods = foodsDoc.exists ? foodsDoc.data().items : [];

    const logsDoc = await db.collection("Backups").doc(key)
      .collection("Logs").doc("data").get();
    const logs = logsDoc.exists ? logsDoc.data() : {};

    const logsRows = [];
    ["breakfast","lunch","snack","dinner"].forEach(meal=>{
      (logs[meal] || []).forEach(e=>{
        logsRows.push({
          Meal: meal,
          Food: e.Food,
          Comment: e.Comment || "",
          ServingSize: e.ServingSize || 0,
          TotalCalories: e.TotalCalories || 0,
          Unit: e.Unit || "",
          Timestamp: e.Timestamp || "",
          CaloriesPerServing: e.CaloriesPerServing || 0
        });
      });
    });

    const wb = XLSX.utils.book_new();
    const wsFoods = XLSX.utils.json_to_sheet(foods);
    const wsLogs  = XLSX.utils.json_to_sheet(logsRows);

    XLSX.utils.book_append_sheet(wb, wsFoods, "Foods");
    XLSX.utils.book_append_sheet(wb, wsLogs,  "Logs");

    XLSX.writeFile(wb, `backup-${key}.xlsx`);
  }

  // restore tool
  document.getElementById("restoreBackup").onclick = restoreBackup;

  async function restoreBackup(){
    const date = prompt("Enter backup date (YYYY-MM-DD)");
    if (!date) return;

    const foodsDoc = await db.collection("Backups").doc(date)
      .collection("Foods").doc("data").get();
    const logsDoc = await db.collection("Backups").doc(date)
      .collection("Logs").doc("data").get();

    if (!foodsDoc.exists || !logsDoc.exists){
      alert("Backup not found.");
      return;
    }

    const foods = foodsDoc.data().items || [];
    const logs  = logsDoc.data() || {};

    // clear active foods
    const foodsSnap = await db.collection("Foods").get();
    for (const d of foodsSnap.docs){
      await db.collection("Foods").doc(d.id).delete();
    }

    // restore foods
    for (const f of foods){
      await db.collection("Foods").doc(f.id).set({
        Food: f.Food,
        Comment: f.Comment || "",
        Unit: f.Unit,
        CaloriesPerServing: f.CaloriesPerServing,
        ServingSize: f.ServingSize || 1
      });
    }

    // clear logs for that date
    for (const meal of ["breakfast","lunch","snack","dinner"]){
      const snap = await db.collection("Logs").doc(date).collection(meal).get();
      for (const d of snap.docs){
        await db.collection("Logs").doc(date).collection(meal).doc(d.id).delete();
      }
    }

    // restore logs
    for (const meal of ["breakfast","lunch","snack","dinner"]){
      for (const e of (logs[meal] || [])){
        await db.collection("Logs").doc(date).collection(meal).doc(e.id).set({
          Food: e.Food,
          Comment: e.Comment || "",
          ServingSize: e.ServingSize || 0,
          TotalCalories: e.TotalCalories || 0,
          Unit: e.Unit || "",
          Timestamp: e.Timestamp || Date.now(),
          CaloriesPerServing: e.CaloriesPerServing || 0
        });
      }
    }

    alert("Restore complete.");
    // loadFoods();  // disable auto-load of food list
    loadLog();
  }

  // automatic backup (today)
  autoBackup();

  async function autoBackup(){
    const key = fmt(new Date());
    const stamp = Date.now();

    await db.collection("Backups").doc(key).set({
      Timestamp: stamp,
      Date: key
    }, {merge:true});

    const foods = await db.collection("Foods").get();
    const foodsData = foods.docs.map(d=>({id:d.id, ...d.data()}));
    await db.collection("Backups").doc(key).collection("Foods").doc("data")
      .set({items: foodsData});

    const b = await db.collection("Logs").doc(key).collection("breakfast").get();
    const l = await db.collection("Logs").doc(key).collection("lunch").get();
    const s = await db.collection("Logs").doc(key).collection("snack").get();
    const d = await db.collection("Logs").doc(key).collection("dinner").get();

    await db.collection("Backups").doc(key).collection("Logs").doc("data")
      .set({
        breakfast: b.docs.map(x=>({id:x.id, ...x.data()})),
        lunch:     l.docs.map(x=>({id:x.id, ...x.data()})),
        snack:     s.docs.map(x=>({id:x.id, ...x.data()})),
        dinner:    d.docs.map(x=>({id:x.id, ...x.data()}))
      });
  }

  // UPC buttons
  if (scanUpcBtn){
    scanUpcBtn.onclick  = () => openUpcScanner();
  }
  if (upcCloseBtn){
    upcCloseBtn.onclick = () => closeUpcModal();
  }

  // init
  pushView("log");
  loadFoods();  // keep foodsCache warm for search (search renders nothing on empty query)
  renderDate();
  loadMostRecentWeight();

  // Offline indicator
  const offlineBanner = document.getElementById("offlineBanner");
  const updateOnlineStatus = () =>
    offlineBanner.classList.toggle("hidden", navigator.onLine);
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  updateOnlineStatus();
});
