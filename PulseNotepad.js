// ==UserScript==
// @name     Notepad+
// @version  1.0
// @grant    none
// match    *://*/*
// match    *://itsm.services.sap/*
// include  *://itsm.services.sap/*
// exclude  *://itsm.services.sap/attach_knowledge*
// ==/UserScript==

/*
 * For example cases you can check Guided Engineering backend:
 * https://supportportaltest-ge-approuter.internal.cfapps.sap.hana.ondemand.com/ahui/#/SupportCase
 */
const forceEnv = null;

// Exposed functions
API = {
  openQuickView,
  sendAnalytics,
  getTemplates,
  Pulse: {
    get: getPulse,
    update: updatePulse,
  },
  GuidedEngineering: {
    getHistoryData,
    getAvailableAutomationsForComponent,
    executeAutomation,
    addFeedbackForAutomation,
  },
};

/**
 * Get pulse record
 */
async function getPulse(case_id) {
  try {
    const res = await caRequest(`/case/pulse/${case_id}`);
    if (res?.length) {
      return res[0];
    }
    if (Array.isArray(res) && res.length === 0) {
      return "New";
    }
    return null;
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**
 * Update pulse record
 */
async function updatePulse(case_id, data) {
  const res = await caRequest(`/case/pulse/${case_id}`, "POST", data);
  return res;
}

function higherVersion(v1, v2) {
  var v1parts = v1.split(".").map(Number);
  var v2parts = v2.split(".").map(Number);
  for (var i = 0; i < v1parts.length; ++i) {
    if (v2parts.length == i) {
      return v1;
    }
    if (v1parts[i] == v2parts[i]) {
      continue;
    } else if (v1parts[i] > v2parts[i]) {
      return v1;
    } else {
      return v2;
    }
  }
  if (v1parts.length != v2parts.length) {
    return v2;
  }
  return v1;
}

async function getTemplates() {
  try {
    const minVersion = "1.6.44";
    const iseVersion = await window.ise.system_info.getISEVersion();
    if (higherVersion(iseVersion, minVersion) === minVersion) {
      return [];
    }
    const res = await ise.events.send("engine-case-get-templates");
    if (!res?.length) {
      return null;
    }
    const parsed = JSON.parse(res);
    const parsedKeys = Object.keys(parsed);
    const templates = [];
    for (let i = 0; i < parsedKeys.length; i++) {
      if (parsedKeys[i].startsWith("template_metadata_")) {
        const template = JSON.parse(parsed[parsedKeys[i]]);
        const templateText = parsed["template_text_" + template.id];
        templates.push({ title: template.title, description: "Maintained by the ServiceNow Tools script.", content: templateText });
      }
    }
    return templates;
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function openQuickView(url) {
  ise.events.send("browserwindow-isewindow-popupwindow-open", url);
}

/**
 * Get Intelligent Automation history for a given correlation id
 */
async function getHistoryData(correlation_id) {
  const res = await iaRequest(`/automations/history/${correlation_id}`);
  if (res?.length) {
    res.sort((a, b) => {
      try {
        if (a?.status === "RUNNING") return -1;
        if (b?.status === "RUNNING") return -1;
        if (moment(a?.completed_ts) > moment(b?.completed_ts)) {
          return -1;
        }
        return 1;
      } catch (e) {
        return 1;
      }
    });
  }
  return res;
}

/**
 * Add feedback for automation
 */
async function addFeedbackForAutomation(automation_id, workflow_id, val) {
  let payload = {
    automation_id,
    workflow_id,
  };
  if (val === null) {
    payload.thumb_up = false;
    payload.thumb_down = false;
  } else {
    if (val) {
      payload.thumb_up = true;
      payload.thumb_down = false;
    } else {
      payload.thumb_up = false;
      payload.thumb_down = true;
    }
  }
  const res = await iaRequest(`/automation/feedback`, "POST", payload);
  return res;
}

/**
 * Get list of Intelligent Automation automations
 */
async function getAvailableAutomationsForComponent(component, product_name) {
  let res = null;
  if (product_name?.length) {
    res = await iaRequest(`/automations/${component}?product=${encodeURIComponent(product_name)}`);
  } else {
    res = await iaRequest(`/automations/${component}`);
  }
  return res;
}

/**
 * Execute an automation for a case
 */
async function executeAutomation(automation_id, correlation_id, component, runtimeOptions) {
  let options = [];
  if (runtimeOptions) {
    runtimeOptions = Object.values(runtimeOptions);
  }
  if (runtimeOptions?.length) {
    for (let i = 0; i < runtimeOptions.length; i++) {
      let values = [];
      // Selectbox
      if (runtimeOptions[i]?.control === "selectbox") {
        if (runtimeOptions[i].values?.value) {
          // Single
          values = [runtimeOptions[i].values.value];
        } else {
          // Multi
          values = runtimeOptions[i].values.map((item) => item.value);
        }
      } else {
        // Freetext
        values = [runtimeOptions[i]?.value || ""];
      }
      options.push({
        name: runtimeOptions[i].option.name,
        values,
      });
    }
  }
  const res = await iaRequest(`/automation/execute`, "POST", {
    id: automation_id,
    incident_no: correlation_id,
    component,
    options,
  });
  return res;
}

/**
 * Sends analytics to HANA
 */
async function sendAnalytics(action, metadata = undefined) {
  ise.events.send("engine-logger-track-hana", {
    view: "case_assistant",
    action,
    metadata,
  });
}

/**
 * Make request to backend-case-assistant
 */
let caToken = null;
async function caRequest(path, method = "GET", body = undefined) {
  if (!caToken) {
    const tokenRes = await ise.events.send("engine-sso-request", {
      env: forceEnv || undefined,
      service: "supportportal_token",
    });
    caToken = tokenRes?.token;
  }
  const res = await ise.events.send("engine-request", {
    service: "backend-case-assistant",
    method,
    env: forceEnv || undefined,
    body,
    path,
    headers: {
      Authorization: `Bearer ${caToken}`,
    },
  });
  return res;
}

/**
 * Make request to backend-guided-engineering
 */

async function iaRequest(path, method = "GET", body = undefined) {
  document.querySelector(".spinner").style.display = "block";

  const tokenRes = await ise.events.send("engine-sso-request", {
    env: forceEnv || undefined,
    service: "guided-engineering-token",
  });
  let iaToken = tokenRes?.token;

  const res = await ise.events.send("engine-request", {
    service: "backend-guided-engineering",
    method,
    env: forceEnv || undefined,
    body,
    path,
    headers: {
      Authorization: `Bearer ${iaToken}`,
    },
  });
  document.querySelector(".spinner").style.display = "none";
  return res;
}

/*****************************************************************************************************/

let caseData;
let pulseData;
let isMinimized = false;
let defaultTopPosition;
let defaultLeftPosition;
try{
  //get position
  if(localStorage.getItem("pulse_notepad_default_position").length > 0){
    defaultLeftPosition = (localStorage.getItem("pulse_notepad_default_position").split(",")[0].trim());
    defaultTopPosition = (localStorage.getItem("pulse_notepad_default_position").split(",")[1].trim());
  }else{
    defaultLeftPosition = "100px";
    defaultTopPosition = "200px";
  }
}catch(err){
  defaultLeftPosition = "100px";
  defaultTopPosition = "200px";
}

try{
  //get mode
  if(localStorage.getItem("pulse_notepad_default_mode").length > 0){
    if(localStorage.getItem("pulse_notepad_default_mode") == "minimized"){
      isMinimized = true;
    }else{
      isMinimized = false;
    }
  }
}catch(err){
  isMinimized = false;
}

let notepadDiv = document.createElement("div");
if(isMinimized){
  drawMinimized();
}else{
  drawMaximized();
}

//set draggable box
container = document.getElementById("pulseNotepad");
function handleMouseMove(event){
  event.preventDefault();
  onMouseDrag(event.x,event.y);
}

function onMouseDrag(movementX, movementY){
  var containerStyle = window.getComputedStyle(container);
  container.style.position = "absolute";
  container.style.left = (movementX-relativeMouseX)+"px";
  container.style.top = (movementY-relativeMouseY)+"px";
  defaultLeftPosition = (movementX-relativeMouseX)+"px";
  defaultTopPosition = (movementY-relativeMouseY)+"px";
  localStorage.setItem("pulse_notepad_default_position",(defaultLeftPosition+","+defaultTopPosition));
}

//detect changes in the text area
try{
  document.getElementById("textArea").addEventListener("input", ()=>{
  updateStoredText();
});
}catch(err){

}

container.addEventListener("mousedown", (e)=>{
  if(e.target.id == "minimizeButton"){
    if(isMinimized){
      drawMaximized();
      isMinimized = false;
      localStorage.setItem("pulse_notepad_default_mode","maximized");
    }else{
      drawMinimized();
      isMinimized = true;
      localStorage.setItem("pulse_notepad_default_mode","minimized");
    }
  }else if(e.target.id == "textArea"){
    
  }else if(e.target.id == "symptomButton"){
    document.getElementById("textArea").value = document.getElementById("textArea").value + "\r\nSYMPTOM\r\n" + trimPulseField(pulseData.symptom);
    updateStoredText();
  }else if (e.target.id == "stepsButton"){
    document.getElementById("textArea").value = document.getElementById("textArea").value + "\r\nSTEPS\r\n" + trimPulseSteps(pulseData.steps_to_reproduce);
    updateStoredText();
  }else if(e.target.id == "dataCollectedButton"){
    document.getElementById("textArea").value = document.getElementById("textArea").value + "\r\nDATA COLLECTED\r\n" + trimPulseField(pulseData.data_collected);
    updateStoredText();
  }else if(e.target.id == "clearButton"){
    document.getElementById("textArea").value = "";
    updateStoredText();
  }else{
    bounds = container.getBoundingClientRect();
    relativeMouseX = e.clientX - bounds.left;
    relativeMouseY = e.clientY - bounds.top;
    document.addEventListener("mousemove", handleMouseMove);
  }
});

document.addEventListener("mouseup",()=>{
  document.removeEventListener("mousemove", handleMouseMove);
});
  
function updateStoredText(){
  localStorage.setItem("pulse_notepad_textarea_content", document.getElementById("textArea").value);
}

function drawMinimized(){
  notepadDiv.setAttribute("id","pulseNotepad");
  notepadDiv.innerHTML = "<div><b style=\"color:white;\">Case<br>Notepad</b><button id=\"minimizeButton\" style=\"float:right;\">🗖</button></div>"
  notepadDiv.setAttribute("style","z-index:999; display:block; position:absolute; top:"+defaultTopPosition+"; left:"+defaultLeftPosition+"; width:85px; heigth:20px; padding:10px;background-color:rgba(0, 0, 0, 0.65);");
  document.body.appendChild(notepadDiv);
}

function drawMaximized(){
  let textContent;
  try{
    textContent = localStorage.getItem("pulse_notepad_textarea_content");
  }catch(err){
    textContent == "";
  }
  console.log(textContent);
  notepadDiv.setAttribute("id","pulseNotepad");
  notepadDiv.innerHTML = "<div><b style=\"color:white;\">Case Notepad</b><span style=\"color:lightGrey; margin-left:10px;\"id=\"caseId\">no case</span><button id=\"minimizeButton\" style=\"float:right;\">🗕</button></div>";
  notepadDiv.innerHTML += "<div><textarea cols=\"50\" rows=\"5\" id=\"textArea\" style=\"display:block; margin:0px; padding:0px;\">"+textContent+"</textarea></div>";
  notepadDiv.innerHTML += "<div style=\"display:inline-block;\"><span style=\"color:white;\">Copy from: </span><button id=\"symptomButton\">Symptom</button><button id=\"stepsButton\">Steps</button><button id=\"dataCollectedButton\">Data Collected</button><button id=\"clearButton\">Clear</button></div>"
  notepadDiv.setAttribute("style","z-index:999; display:block; position:absolute; top:"+defaultTopPosition+"; left:"+defaultLeftPosition+"; heigth:300px; padding:10px;background-color:rgba(0, 0, 0, 0.65);");
  document.body.appendChild(notepadDiv);

  document.getElementById("textArea").addEventListener("input", ()=>{
    updateStoredText();
  });
}

//Setting content when case is opened
ise.case.onUpdate2(
  async (receivedCaseData) => {
    if(receivedCaseData.types[0] != "newcase"){
      if(receivedCaseData.types[0] == "nocase"){
        document.getElementById("caseId").innerHTML = "no case";
      }else{
        document.getElementById("caseId").innerHTML = receivedCaseData.headers.data.number + " - "+(receivedCaseData.title.substring(0,25) + "...");
        caseData = receivedCaseData;
        API.Pulse.get(receivedCaseData.id).then(async(pulse)=>{
          pulseData = pulse;
        });
      }
    }
    
},
//this seems to be what requests communication data from case
["communication","headers"]);

function trimPulseField(fieldData){
  let trimmedValue = fieldData.substring(3);
  trimmedValue = trimmedValue.substring(0,(trimmedValue.length-4));
  return trimmedValue;
}

function trimPulseSteps(fieldData){
let trimmedValue = fieldData;
  trimmedValue = trimmedValue.substring(0,(trimmedValue.length-4));
  trimmedValue = trimmedValue.replaceAll("<li>","\r\n-");
  trimmedValue = trimmedValue.replaceAll("</li>","");
  trimmedValue = trimmedValue.replaceAll("<p>","");
  trimmedValue = trimmedValue.replaceAll("</p>","");
  trimmedValue = trimmedValue.replaceAll("&gt;",">");
  trimmedValue = trimmedValue.replaceAll("<ol>","");
  trimmedValue = trimmedValue.replaceAll("</ol>","");
  return trimmedValue;
}