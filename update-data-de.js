const fetch = require("node-fetch");
const fs = require("fs");
const CSVtoJSON = require("csvtojson");

const estimatesForMissingHospitalizationData = require("./data/estimates_for_missing_hospitalization_data.json");

// Do not remove this import! We want to load paramConfig.json at build time so that if somebody
// has accidentally broken the JSON by manual editing, build process is halted.
const paramConfig = require("./src/paramConfig.json");

const lastMidnight = new Date().setUTCHours(0, 0, 0, 0);
const cutoffDays = 3; // For example, 3 means "cut off today + 3 previous days".

function notTooRecent(dateTime) {
  const daysFromLastMidnight = Math.round(
    (new Date(dateTime).getTime() - new Date(lastMidnight).getTime()) / 86400000
  );
  return daysFromLastMidnight < -cutoffDays;
}

function verifyDataNotStale(lastSeenDay, days) {
  // Verify that API is not serving stale data which is missing recent days completely.
  if (lastSeenDay !== days - 1) {
    process.exit(1);
  }
}

function write(relativePath, content) {
  fs.writeFile(relativePath, content, function (err) {
    if (err) {
      console.log(err);
      process.exit(1); // Prevent build if disk write fails
    }
  });
}

async function callbackRtEstimate(response) {
  response
    .text()
    .then((text) => {
      const splitted = text.split(/\r?\n/);
      const lastLine = splitted[splitted.length - 2];
      const lastRtEstimateValue = Number.parseFloat(lastLine.split(",")[1]);
      const lastRtEstimateDate = lastLine.split(",")[0];
      console.log("Last Rt estimate:", lastRtEstimateValue, lastRtEstimateDate);
      if (lastRtEstimateValue > 0 && lastRtEstimateValue < 10) {
        write(
          "data/latest_Rt.csv",
          `date,Rt\n${lastRtEstimateDate},${lastRtEstimateValue}`
        );
      } else {
        process.exit(1); // Prevent build if estimate out of bounds.
      }
    })
    .catch((error) => {
      console.log(error);
      process.exit(1); // Prevent build if parse fails
    });
}

async function callbackRtPNG(response) {
  response
    .buffer()
    .then((blob) => {
      write("public/latest_Rt.png", blob);
    })
    .catch((error) => {
      console.log(error);
      process.exit(1); // Prevent build if parse fails
    });
}

function convertToJSON() {
  return CSVtoJSON()
    .fromFile("data/rki_raw_cases_and_deaths.csv")
    .then((rkiData) => {
      return rkiData;
    })
    .catch((err) => {
      console.log(err);
    });
}

function initializeParsedArray(epidemyStartDate, days) {
  var parsed = {};
  parsed["epidemyStartDate"] = epidemyStartDate;
  parsed["days"] = days;
  const thingsToCount = ["newConfirmedCases", "cumulativeConfirmedCases", "newConfirmedDeaths", "cumulativeConfirmedDeaths"];
  for (var i = 0; i < thingsToCount.length; i++) {
    const thing = thingsToCount[i];
    parsed[thing] = {};
    for (var day = 0; day < days; day++) {
      parsed[thing][day] = 0;
    }
  }
  return parsed
}

function countCases(parsed, json, oldColumnName, newColumnName, epidemyStartDate){
  var lastSeenDay = 0
        for (var i=0; i<json.length; i++) {
            const c = json[i]
            const dateTime = new Date(Date.parse(c["date"])).setUTCHours(0,0,0,0);
            if (notTooRecent(dateTime)) {
                // Exclude today's data by assumption that it is missing entries.
                const day = daysFromZero(dateTime, epidemyStartDate)
                parsed[newColumnName][day] = json[day][oldColumnName]
                lastSeenDay = Math.max(day, lastSeenDay)
            }
        }
  return parsed
}

function daysFromZero(dateTime, epidemyStartDate) {
  return Math.round(
    (new Date(dateTime).getTime() - new Date(epidemyStartDate).getTime()) / 86400000
  );
}

async function callbackRKIConfirmedCasesAndDeaths(response) {
  response
    .text()
    .then((text) => {
      // Keep the original CSV for debugging purposes.
      write("data/rki_raw_cases_and_deaths.csv", text);
      return convertToJSON();
    })
    .then((json) => {
      console.log(json);
      const epidemyStartDate = new Date( Date.parse(json[0]["date"])).setUTCHours(0, 0, 0, 0);
      const days = daysFromZero(lastMidnight, epidemyStartDate) - cutoffDays;
      var parsed = initializeParsedArray(epidemyStartDate, days);
      parsed = countCases(parsed, json, 'newinfections', 'newConfirmedCases',epidemyStartDate)
      parsed = countCases(parsed, json, 'infections', 'cumulativeConfirmedCases', epidemyStartDate)
      parsed = countCases(parsed, json, 'newdeaths', 'newConfirmedDeaths', epidemyStartDate)
      parsed = countCases(parsed, json, 'deaths', 'cumulativeConfirmedDeaths',epidemyStartDate)

      write("data/rki_parsed.json", JSON.stringify(parsed))
    });
}

async function fetchOrExit(url, callback, additionalDataForCallback) {
  return await fetch(url)
    .then((response) => {
      if (!response.ok) {
        console.log(response);
        process.exit(1); // Prevent build if fetch fails
      }
      return response;
    })
    .then(function (response) {
      return callback(response, additionalDataForCallback);
    })
    .catch((error) => {
      console.log(error);
      process.exit(1); // Prevent build if parse fails
    });
}

function fetchRtEstimateData() {
  fetchOrExit(
    "https://corosim-de-r-value.s3.eu-central-1.amazonaws.com/latest_Rt.csv",
    callbackRtEstimate
  );
  fetchOrExit(
    "https://corosim-de-r-value.s3.eu-central-1.amazonaws.com/latest_Rt.png",
    callbackRtPNG
  );
}

function fetchRKIData() {
  fetchOrExit(
    "https://corosim-de-r-value.s3.eu-central-1.amazonaws.com/confirmed_infections_and_deaths.csv",
    callbackRKIConfirmedCasesAndDeaths
  );
  // Please see the callback function; it initiates a second fetch to a different file.
}

fetchRtEstimateData()
fetchRKIData()
