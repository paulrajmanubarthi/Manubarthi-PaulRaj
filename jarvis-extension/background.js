// Track connected side panel ports to know when the panel is open
const sidePanelPorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'jarvis-panel') return;
  sidePanelPorts.add(port);
  port.onDisconnect.addListener(() => sidePanelPorts.delete(port));
});

function togglePanel(tab) {
  if (sidePanelPorts.size > 0) {
    sidePanelPorts.forEach((port) => port.postMessage({ type: 'CLOSE_PANEL' }));
  } else if (tab?.windowId) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
}

// chrome.commands.onCommand passes the active tab as the second argument (Chrome 98+)
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-panel') togglePanel(tab);
});

chrome.action.onClicked.addListener((tab) => {
  togglePanel(tab);
});
