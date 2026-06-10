
  // init
  pushView("log");
  loadFoods();
  renderDate();
  loadMostRecentWeight();
});

// (your existing app.js code above)

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

  // deploy.bat overwrites this line
  const versionNumber = "V 189";

  const fullVersion = `${versionNumber} ${mm}/${dd}/${yyyy} ${time}`;

  // Footer
  document.getElementById("versionLabel").textContent = fullVersion;

  // Title
  document.getElementById("pageTitle").textContent =
    `Calorie Counter — ${fullVersion}`;
}

updateVersionLabel();