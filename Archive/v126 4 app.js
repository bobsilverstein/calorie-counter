/* v126 — synced pair */

document.addEventListener("DOMContentLoaded", () => {

  let currentMeal = "breakfast";
  let foods = [];
  let meals = { breakfast: [], lunch: [], snack: [], dinner: [] };
  let currentDate = new Date();

  const db = firebase.firestore();

  const viewLog = document.getElementById("view-log");
  const viewAdd = document.getElementById("view-add");
  const viewFoods = document.getElementById("view-foods");

  const navLog = document.getElementById("navLog");
  const navAdd = document.getElementById("navAdd");
  const navFoods = document.getElementById("navFoods");

  const mealsList = document.getElementById("mealsList");

  const addSearch = document.getElementById("addSearch");
  const addResults = document.getElementById("addResults");

  const addFoodName = document.getElementById("addFoodName");
  const addComment = document.getElementById("addComment");
  const addCalories = document.getElementById("addCalories");
  const addServingSize = document.getElementById("addServingSize");

  const foodsSearch = document.getElementById("foodsSearch");
  const foodsList = document.getElementById("foodsList");

  const foodsFoodName = document.getElementById("foodsFoodName");
  const foodsComment = document.getElementById("foodsComment");
  const foodsCalories = document.getElementById("foodsCalories");
  const foodsServingSize = document.getElementById("foodsServingSize");

  const versionLabel = document.getElementById("versionLabel");
  const dayLabel = document.getElementById("dayLabel");
  const totalCalories = document.getElementById("totalCalories");

  const ts = new Date().toLocaleString("en-US", {
    month:"2-digit", day:"2-digit", year:"numeric",
    hour:"2-digit", minute:"2-digit", hour12:true
  });
  versionLabel.textContent = "V126 " + ts;

  function show(v) {
    viewLog.classList.add("hidden");
    viewAdd.classList.add("hidden");
    viewFoods.classList.add("hidden");
    v.classList.remove("hidden");
  }

  show(viewLog);

  navLog.onclick = () => show(viewLog);
  navAdd.onclick = () => show(viewAdd);
  navFoods.onclick = () => show(viewFoods);

  function fmt(d) {
    return d.toLocaleDateString("en-US", {
      weekday:"short", month:"short", day:"numeric"
    });
  }

  function dateKey(d) {
    return d.toLocaleDateString("en-US", {
      month:"2-digit", day:"2-digit", year:"numeric"
    });
  }

  function updateDateUI() {
    dayLabel.textContent = fmt(currentDate);
    loadMeals();
  }

  document.getElementById("prevDay").onclick = () => {
    currentDate.setDate(currentDate.getDate() - 1);
    updateDateUI();
  };

  document.getElementById("nextDay").onclick = () => {
    currentDate.setDate(currentDate.getDate() + 1);
    updateDateUI();
  };

  function loadMeals() {
    const key = dateKey(currentDate);

    db.collection("DailyLog")
      .doc(key)
      .get()
      .then(doc => {
        if (doc.exists) meals = doc.data();
        else meals = { breakfast: [], lunch: [], snack: [], dinner: [] };
        renderMeals();
      });
  }

  function saveMeals() {
    const key = dateKey(currentDate);
    db.collection("DailyLog").doc(key).set(meals);
  }

  db.collection("Foods")
    .orderBy("Food")
    .onSnapshot(snap => {
      foods = [];
      snap.forEach(doc => foods.push({ id: doc.id, ...doc.data() }));
      renderFoodsList();
      renderAddResults();
    });

  function renderFoodsList() {
    const q = foodsSearch.value.toLowerCase();
    foodsList.innerHTML = "";

    foods
      .filter(f => f.Food.toLowerCase().includes(q))
      .forEach(f => {
        const div = document.createElement("div");
        div.className = "p-2 cursor-pointer hover:bg-slate-100";
        div.textContent = f.Food;
        div.onclick = () => loadFoodEditor(f);
        foodsList.appendChild(div);
      });
  }

  foodsSearch.oninput = renderFoodsList;

  function loadFoodEditor(f) {
    foodsFoodName.value = f.Food;
    foodsComment.value = f.Comment || "";
    foodsCalories.value = f.CaloriesPerServing;
    foodsServingSize.value = f.ServingSize;
  }

  function renderAddResults() {
    const q = addSearch.value.toLowerCase();
    addResults.innerHTML = "";

    foods
      .filter(f => f.Food.toLowerCase().includes(q))
      .forEach(f => {
        const div = document.createElement("div");
        div.className = "p-2 border rounded cursor-pointer hover:bg-slate-100";
        div.innerHTML = `
          <div class="font-semibold">${f.Food}</div>
          <div class="text-xs text-slate-500">${f.CaloriesPerServing} cal/${f.Unit}</div>
        `;
        div.onclick = () => loadAddEditor(f);
        addResults.appendChild(div);
      });
  }

  addSearch.oninput = renderAddResults;

  function loadAddEditor(f) {
    addFoodName.value = f.Food;
    addComment.value = f.Comment || "";
    addCalories.value = f.CaloriesPerServing;
    addServingSize.value = f.ServingSize;
  }

  document.getElementById("addSave").onclick = () => {
    const entry = {
      Food: addFoodName.value,
      Comment: addComment.value,
      CaloriesPerServing: Number(addCalories.value),
      ServingSize: Number(addServingSize.value),
      Unit: "g"
    };

    meals[currentMeal].push(entry);
    saveMeals();
    renderMeals();
    show(viewLog);
  };

  document.getElementById("clearAll").onclick = () => {
    meals = { breakfast: [], lunch: [], snack: [], dinner: [] };
    saveMeals();
    renderMeals();
  };

  document.getElementById("manageFoods").onclick = () => {
    show(viewFoods);
  };

  function renderMeals() {
    mealsList.innerHTML = "";

    let total = 0;

    ["breakfast", "lunch", "snack", "dinner"].forEach(meal => {
      const items = meals[meal];
      const subtotal = items.reduce((s, f) => s + f.CaloriesPerServing, 0);
      total += subtotal;

      const div = document.createElement("div");
      div.className = "border rounded p-2 hover:bg-slate-100 cursor-pointer";

      div.innerHTML = `
        <div class="font-bold capitalize">${meal} (${subtotal} cal)</div>
        <div class="text-sm text-slate-600">+ add to ${meal}</div>
      `;

      div.onclick = () => {
        currentMeal = meal;
        highlightMeal();
        show(viewAdd);
      };

      mealsList.appendChild(div);
    });

    totalCalories.textContent = total + " calories";
  }

  function highlightMeal() {
    document.querySelectorAll(".meal-toggle").forEach(b => {
      b.classList.toggle("bg-blue-200", b.dataset.meal === currentMeal);
    });
  }

  updateDateUI();
});
