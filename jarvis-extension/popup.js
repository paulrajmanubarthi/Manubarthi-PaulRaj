// Extension API Bridge
// This thin layer connects the iframe UI to Chrome extension APIs

console.log('[Extension Bridge] Initializing...');

// Connect to background so it can detect when the panel is open and toggle it.
// Reconnects automatically if the background service worker restarts.
function connectPanelPort() {
  const port = chrome.runtime.connect({ name: 'jarvis-panel' });
  port.onMessage.addListener((msg) => {
    if (msg.type === 'CLOSE_PANEL') window.close();
  });
  port.onDisconnect.addListener(() => {
    setTimeout(connectPanelPort, 1000);
  });
}
connectPanelPort();

// Listen for tab changes directly in the side panel page.
// This is more reliable than routing through the background service worker,
// which is frequently suspended in MV3 and loses its port set on restart.
function sendRefresh() {
  iframe.contentWindow?.postMessage({ type: 'REFRESH_PAGE_INFO' }, '*');
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') sendRefresh();
    // If still loading, onUpdated will fire when complete
  } catch (_) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) sendRefresh();
});

const iframe = document.getElementById('ui-iframe');
const errorScreen = document.getElementById('error-screen');

// Load iframe with correct API URL
(async () => {
  const apiUrl = await getApiUrl();
  const devMode = await isLocalBuild();
  const env = devMode ? 'local' : 'production';
  console.log('[Extension Bridge] Using API URL:', apiUrl, 'env:', env);
  iframe.src = `${apiUrl}/extension-ui?env=${env}`;
})();

// Check if backend is running
iframe.addEventListener('load', () => {
  console.log('[Extension Bridge] Iframe loaded successfully');
  iframe.classList.remove('hidden');
  errorScreen.classList.add('hidden');
});

iframe.addEventListener('error', () => {
  console.error('[Extension Bridge] Failed to load iframe');
  iframe.classList.add('hidden');
  errorScreen.classList.remove('hidden');
});

// Listen for messages from iframe
window.addEventListener('message', async (event) => {
  // Only accept messages from our iframe
  if (event.source !== iframe.contentWindow) return;

  const { type, action, data, requestId } = event.data;

  console.log('[Extension Bridge] Received message:', type, action);

  // Iframe is ready
  if (type === 'IFRAME_READY') {
    console.log('[Extension Bridge] Iframe ready, sending handshake...');
    iframe.contentWindow.postMessage({ type: 'EXTENSION_READY' }, '*');
    return;
  }

  // Handle extension API requests
  if (type === 'EXTENSION_REQUEST') {
    let result = {};

    try {
      switch (action) {
        case 'getPageInfo':
          result = await getPageInfo();
          break;
        
        case 'getPageConfig':
          result = await getPageConfig();
          break;
        
        case 'extractDOM':
          result = await extractDOM();
          break;
        
        case 'simulateSelector':
          if (data.type === 'preorder') {
            result = await simulatePreorder(data.buttonSelectors, data.positionSelectors);
          } else {
            result = await simulateSelector(data.selector, data.insertType);
          }
          break;
        
        case 'clearSimulation':
          result = await clearSimulation();
          break;
        
        case 'getAuthToken':
          result = await getAuthToken();
          break;
        
        case 'setAuthToken':
          result = await setAuthToken(data.token);
          break;
        
        case 'clearAuthToken':
          result = await clearAuthToken();
          break;
        
        case 'getDevMode':
          result = await handleGetDevMode();
          break;
        
        case 'setDevMode':
          result = await handleSetDevMode(data.enabled);
          break;
        
        case 'validateSelector':
          result = await validateSelector(data.selector);
          break;
        
        case 'validateButtonChild':
          result = await validateButtonChild(data.buttonSelector, data.childSelector);
          break;
        
        case 'peekElement':
          result = await peekElement(data);
          break;
        
        default:
          result = { error: `Unknown action: ${action}` };
    }
  } catch (error) {
      console.error('[Extension Bridge] Error handling request:', error);
      result = { error: error.message };
    }

    // Send response back to iframe
    iframe.contentWindow.postMessage({
      type: 'EXTENSION_RESPONSE',
      requestId,
      result,
    }, '*');
  }
});

// ========== EXTENSION API FUNCTIONS ==========

async function getPageInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      return { success: false, error: 'No active tab' };
    }

    // Can't inject into browser-internal or extension pages
    if (!tab.url || /^(chrome|chrome-extension|about|edge|brave):/.test(tab.url)) {
      return { success: false, error: 'Cannot access this page' };
    }

    // Execute script to get page info
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        let pageType = 'product';
        
        if (window._RestockRocketConfig?.pageType) {
          pageType = window._RestockRocketConfig.pageType;
        } else {
          const url = window.location.pathname;
          if (url.includes('/collections/') || url.match(/^\/collections$/)) {
            pageType = 'collection';
          } else if (url.includes('/search')) {
            pageType = 'search';
          } else if (url === '/' || url === '') {
            pageType = 'index';
          } else if (url.includes('/products/')) {
            pageType = 'product';
          }
        }
        
        return {
          pageType: pageType,
          shop: window._RestockRocketConfig?.shop?.myshopify_domain || window.Shopify?.shop || null,
          url: window.location.href,
        };
      },
    });

    if (results && results[0]?.result) {
      return { success: true, data: results[0].result };
    }
    
    return { success: false, error: 'Failed to get page info' };
  } catch (error) {
    console.error('[Extension Bridge] Error getting page info:', error);
    return { success: false, error: error.message };
  }
}

async function extractDOM() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      return { success: false, error: 'No active tab found' };
    }

    // Check if we can access the page
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      return { success: false, error: 'Cannot analyze Chrome internal pages' };
    }

    // Inject content script if needed
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
    } catch (injectError) {
      // Content script might already be loaded
      console.log('[Extension Bridge] Content script injection warning:', injectError.message);
    }

    // Wait for script to initialize
    await new Promise(resolve => setTimeout(resolve, 500));

    // Extract DOM
    try {
      const domResult = await chrome.tabs.sendMessage(tab.id, { type: 'extractDOM' });
      return domResult;
    } catch (error) {
      if (error.message && error.message.includes('Receiving end does not exist')) {
        return { success: false, error: 'Content script not loaded. Please refresh the product page and try again.' };
      }
      return { success: false, error: 'Failed to extract page content. Try refreshing the page.' };
    }
  } catch (error) {
    console.error('[Extension Bridge] Error extracting DOM:', error);
    return { success: false, error: error.message };
  }
}

async function simulateSelector(selector, insertType) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      return { success: false, error: 'No active tab' };
    }

    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'simulateNotifyMe',
      selector: selector,
      insertType: insertType,
    });

    return result;
  } catch (error) {
    console.error('[Extension Bridge] Error simulating selector:', error);
    return { success: false, error: error.message };
  }
}

async function simulatePreorder(buttonSelectors, positionSelectors) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      return { success: false, error: 'No active tab' };
    }

    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'simulatePreorderSetup',
      buttonSelectors: buttonSelectors,
      positionSelectors: positionSelectors,
    });

    return result;
  } catch (error) {
    console.error('[Extension Bridge] Error simulating preorder:', error);
    return { success: false, error: error.message };
  }
}

async function clearSimulation() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      return { success: false, error: 'No active tab' };
    }

    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'clearSimulation',
    });

    return result;
  } catch (error) {
    // Fail silently - might not be any simulation to clear
    console.log('[Extension Bridge] Clear simulation warning:', error.message);
    return { success: true };
  }
}

async function getPageConfig() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      return { success: false, error: 'No active tab' };
    }

    if (!tab.url || /^(chrome|chrome-extension|about|edge|brave):/.test(tab.url)) {
      return { success: false, error: 'Cannot access this page' };
    }

    // Execute script to get full _RestockRocketConfig
    const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        return {
          config: window._RestockRocketConfig || null,
          product: window._RestockRocketConfig?.product || null,
          shopify: {
            shop: window.Shopify?.shop || null,
            theme: window.Shopify?.theme || null,
            currency: window.Shopify?.currency || null,
          },
          url: window.location.href,
        };
      },
    });

    if (results && results[0]?.result) {
      return { success: true, data: results[0].result };
    }
    
    return { success: false, error: 'Failed to get page config' };
  } catch (error) {
    console.error('[Extension Bridge] Error getting page config:', error);
    return { success: false, error: error.message };
  }
}

async function getAuthToken() {
  try {
    const result = await chrome.storage.local.get(['authToken']);
    return { success: true, token: result.authToken || null };
  } catch (error) {
    console.error('[Extension Bridge] Error getting auth token:', error);
    return { success: false, error: error.message };
  }
}

async function setAuthToken(token) {
  try {
    await chrome.storage.local.set({ authToken: token });
    return { success: true };
  } catch (error) {
    console.error('[Extension Bridge] Error setting auth token:', error);
    return { success: false, error: error.message };
  }
}

async function clearAuthToken() {
  try {
    await chrome.storage.local.remove(['authToken']);
    return { success: true };
  } catch (error) {
    console.error('[Extension Bridge] Error clearing auth token:', error);
    return { success: false, error: error.message };
  }
}

async function isLocalBuild() {
  const apiUrl = await getApiUrl();
  return apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1');
}

async function handleGetDevMode() {
  try {
    const devMode = await isLocalBuild();
    return { success: true, devMode };
  } catch (error) {
    console.error('[Extension Bridge] Error getting dev mode:', error);
    return { success: false, error: error.message };
  }
}

async function handleSetDevMode() {
  return {
    success: false,
    error: 'Environment is fixed by extension build. Use build:dev or build:prod and reload the extension.',
  };
}

/**
 * Validates a CSS selector by counting how many elements it matches on the active page
 * @param {string} selector - CSS selector to validate
 * @returns {Promise<{success: boolean, count?: number, error?: string}>}
 *   - success: Whether validation succeeded
 *   - count: Number of matching elements (0 = not found, -1 = invalid syntax)
 */
async function validateButtonChild(buttonSelector, childSelector) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      return { success: false, error: 'No active tab' };
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (btnSel, childSel) => {
        try {
          const buttons = document.querySelectorAll(btnSel);
          if (buttons.length === 0) {
            return { count: -2, elements: [] }; // Button not found
          }
          
          // Check inside first button only
          const button = buttons[0];
          let children;
          
          if (!childSel || childSel === '') {
            // Empty selector means check if button has text directly
            const hasDirectText = button.childNodes.length === 0 || 
                                   Array.from(button.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
            return {
              count: hasDirectText ? 1 : 0,
              elements: hasDirectText ? [{
                index: 1,
                tag: 'text node',
                id: '',
                classes: '',
                text: button.textContent?.trim().substring(0, 50) || ''
              }] : []
            };
          }
          
          children = button.querySelectorAll(childSel);
          
          const elementDetails = Array.from(children).slice(0, 5).map((el, idx) => {
            let idStr = '';
            if (el.id) {
              idStr = typeof el.id === 'string' ? el.id : String(el.id);
            }
            
            let classesStr = '';
            if (el.className) {
              if (typeof el.className === 'string') {
                classesStr = el.className.trim();
              } else if (el.className.baseVal) {
                classesStr = el.className.baseVal;
              } else {
                classesStr = String(el.className).trim();
              }
            }
            
            return {
              index: idx + 1,
              tag: el.tagName.toLowerCase(),
              id: idStr,
              classes: classesStr,
              text: el.textContent?.trim().substring(0, 50) || '',
            };
          });
          
          return {
            count: children.length,
            elements: elementDetails
          };
        } catch (e) {
          return { count: -1, elements: [] };
        }
      },
      args: [buttonSelector, childSelector]
    });

    const result = results && results[0] ? results[0].result : { count: 0, elements: [] };
    
    return { success: true, count: result.count, elements: result.elements };
  } catch (error) {
    console.error('[Extension Bridge] Validate button child error:', error);
    return { success: false, error: error.message };
  }
}

async function validateSelector(selector) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      return { success: false, error: 'No active tab' };
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (sel) => {
        try {
          const elements = document.querySelectorAll(sel);
          const elementDetails = Array.from(elements).slice(0, 5).map((el, idx) => {
            // Handle ID properly - could be object or string
            let idStr = '';
            if (el.id) {
              idStr = typeof el.id === 'string' ? el.id : String(el.id);
            }
            
            // Handle classes properly
            let classesStr = '';
            if (el.className) {
              if (typeof el.className === 'string') {
                classesStr = el.className.trim();
              } else if (el.className.baseVal) {
                // SVG elements
                classesStr = el.className.baseVal;
              } else {
                classesStr = String(el.className).trim();
              }
            }
            
            return {
              index: idx + 1,
              tag: el.tagName.toLowerCase(),
              id: idStr,
              classes: classesStr,
              text: el.textContent?.trim().substring(0, 50) || '',
            };
          });
          
          return {
            count: elements.length,
            elements: elementDetails
          };
        } catch (e) {
          return { count: -1, elements: [] }; // Invalid selector syntax
        }
      },
      args: [selector]
    });

    const result = results && results[0] ? results[0].result : { count: 0, elements: [] };
    
    return { success: true, count: result.count, elements: result.elements };
  } catch (error) {
    console.error('[Extension Bridge] Validate selector error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Temporarily highlights element(s) on the page for visual confirmation
 * Adds blue outline and background for 3 seconds, scrolls first element into view
 * Shows preview of where element would be inserted (if insertType provided)
 * For buttonChild, uses parentSelector to find button first, then child element within it
 * @param {object} data - Peek data
 * @param {string} data.selector - CSS selector to highlight
 * @param {string} [data.insertType] - Insert position (beforebegin, afterbegin, beforeend, afterend)
 * @param {string} [data.label] - Label for the preview element
 * @param {string} [data.parentSelector] - Parent selector (for buttonChild)
 * @returns {Promise<{success: boolean, count?: number, elementInfo?: object, message?: string, error?: string}>}
 */
async function peekElement(data) {
  const { selector, insertType, label, parentSelector } = data;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      return { success: false, error: 'No active tab' };
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (sel, insType, lbl, parentSel) => {
        try {
          let elements;
          let targetElement; // For buttonChild, the parent button
          
          // Special handling for buttonChild - find parent button first
          if (parentSel && lbl === 'buttonChild') {
            const parentElements = document.querySelectorAll(parentSel);
            if (parentElements.length === 0) {
              return { success: false, message: 'Parent button not found' };
            }
            targetElement = parentElements[0];
            
            // Find child element within button
            const childElement = targetElement.querySelector(sel);
            if (!childElement) {
              return { success: false, message: 'Child element not found within button' };
            }
            elements = [childElement];
          } else {
            elements = document.querySelectorAll(sel);
            if (elements.length === 0) {
              return { success: false, message: 'No elements found' };
            }
          }

          // Clean up any existing peek preview
          const existingPreview = document.querySelector('.restock-rocket-peek-preview');
          if (existingPreview) {
            existingPreview.remove();
          }

          const firstEl = elements[0];

          // Highlight the found element(s) with numbered badges
          elements.forEach((el, idx) => {
            const originalOutline = el.style.outline;
            const originalBackground = el.style.backgroundColor;
            const originalPosition = el.style.position;
            const originalZIndex = el.style.zIndex;
            
            el.style.outline = '3px solid #3b82f6';
            el.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
            el.style.transition = 'all 0.3s';
            el.style.position = 'relative';
            el.style.zIndex = '9999';
            
            // Add numbered badge for multiple elements
            if (elements.length > 1) {
              const badge = document.createElement('div');
              badge.className = 'restock-rocket-peek-badge';
              badge.textContent = '#' + (idx + 1);
              badge.style.cssText = 'position: absolute; top: -10px; right: -10px; background: #3b82f6; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; z-index: 10000; box-shadow: 0 2px 4px rgba(0,0,0,0.2);';
              el.appendChild(badge);
              
              setTimeout(() => {
                badge.remove();
              }, 3000);
            }
            
            // Scroll first element into view
            if (idx === 0) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            
            // Restore original styles after 3 seconds
            setTimeout(() => {
              el.style.outline = originalOutline;
              el.style.backgroundColor = originalBackground;
              el.style.position = originalPosition;
              el.style.zIndex = originalZIndex;
            }, 3000);
          });
          
          // Also highlight the parent button if this is buttonChild
          if (targetElement && lbl === 'buttonChild') {
            const originalOutline = targetElement.style.outline;
            targetElement.style.outline = '2px dashed #10b981';
            targetElement.style.transition = 'all 0.3s';
            
            setTimeout(() => {
              targetElement.style.outline = originalOutline;
            }, 3000);
          }

          // Show preview of where element would be inserted (for position selectors)
          if (insType && lbl && lbl !== 'buttonChild') {
            // Add animation style if not exists
            if (!document.querySelector('.restock-rocket-peek-style')) {
              const peekStyle = document.createElement('style');
              peekStyle.className = 'restock-rocket-peek-style';
              peekStyle.textContent = '@keyframes peekPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.8; } }';
              document.head.appendChild(peekStyle);
            }
            
            const preview = document.createElement('div');
            preview.className = 'restock-rocket-peek-preview';
            preview.style.cssText = 'padding: 10px; margin: 8px 0; border-radius: 6px; border: 2px dashed #4ade80; background: rgba(74, 222, 128, 0.1); animation: peekPulse 2s infinite;';
            preview.innerHTML = '<span style="background: #000; color: #4ade80; font-size: 10px; padding: 2px 6px; border-radius: 3px; font-weight: 600; display: inline-block; margin-right: 4px;">PEEK: ' + lbl.toUpperCase() + '</span> Element would appear here';
            
            // Insert preview based on insertType
            try {
              firstEl.insertAdjacentElement(insType, preview);
            } catch (e) {
              // Fallback if insertType is invalid
              firstEl.insertAdjacentElement('afterend', preview);
            }
            
            // Remove preview after 3 seconds
            setTimeout(() => {
              preview.remove();
            }, 3000);
          }

          // Get info about first element
          const elementInfo = {
            tag: firstEl.tagName.toLowerCase(),
            id: firstEl.id || '',
            classes: firstEl.className || '',
            text: firstEl.textContent?.trim() || ''
          };

          return { 
            success: true, 
            count: elements.length,
            elementInfo: elementInfo
          };
        } catch (e) {
          return { success: false, message: e.message };
        }
      },
      args: [selector, insertType || null, label || '', parentSelector || null]
    });

    const result = results && results[0] ? results[0].result : { success: false };
    
    return result;
  } catch (error) {
    console.error('[Extension Bridge] Peek element error:', error);
    return { success: false, error: error.message };
  }
}

console.log('[Extension Bridge] Ready!');
