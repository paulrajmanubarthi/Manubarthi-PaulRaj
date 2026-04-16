(function () {
  const buttonSelectors = [
    ".add-to-cart",
    ".product-form__submit",
    ".btn--add-to-cart",
    ".button--add-to-cart",
    '[name="add"]',
    '[data-action="add-to-cart"]',
    ".shopify-payment-button__button",
    ".sold-out",
    ".button--sold-out",
    "button[type='submit']"
  ];

  const ignoreSelectors = [
    ".shopify-payment-button",
    ".dynamic-checkout",
    "[data-shopify='payment-button']",
  ];

  // Add this at the top level of your IIFE
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'updateColor') {
      injectStyles();
    }
    
    if (message.type === 'extractDOM') {
      // Extract DOM with smart filtering to reduce token cost
      (async () => {
        try {
        // Build lightweight representation
        const elements = [];

        // Helper function to generate generic selector (no template IDs/numbers)
        function getGenericSelector(el, scopeContainer = null) {
          if (!el) return '';
          
          const parts = [];
          
          // Add scope container first if provided
          if (scopeContainer) {
            parts.push(getElementIdentifier(scopeContainer));
          }
          
          // Add the element's identifier
          parts.push(getElementIdentifier(el));
          
          return parts.filter(Boolean).join(' ');
        }

        function getElementIdentifier(el) {
          const tag = el.tagName.toLowerCase();
          
          // Custom elements are great identifiers (product-info, variant-selects, etc)
          if (tag.includes('-')) {
            return tag;
          }
          
          // Check for ID without numbers/templates (ensure it's a string first)
          if (el.id && typeof el.id === 'string' && !el.id.match(/\d|template|section/i)) {
            return `#${el.id}`;
          }
          
          // Use meaningful class names (no numbers, no random hashes, no animations)
          const classes = Array.from(el.classList || [])
            .filter(c => 
              c && 
              !c.match(/\d/) &&  // no numbers
              !c.match(/^[a-f0-9-]{8,}/) &&  // no hash-like strings
              !c.includes('restock-rocket') &&
              !c.includes('animate') &&
              !c.includes('scroll-trigger') &&
              !c.includes('gradient') &&
              !c.includes('color-') &&
              !c.includes('hidden')
            )
            .slice(0, 2);  // max 2 classes
          
          if (classes.length > 0) {
            return `${tag}.${classes.join('.')}`;
          }
          
          // Fallback: use data attributes
          if (el.hasAttribute('data-type')) {
            return `${tag}[data-type="${el.getAttribute('data-type')}"]`;
          }
          
          // Last resort: just tag (if combined with parent scope, still useful)
          return tag;
        }

        // Helper to calculate DOM distance between elements
        function getDOMDistance(el1, el2) {
          if (!el1 || !el2) return Infinity;
          
          // Check if one contains the other
          if (el1.contains(el2)) {
            let depth = 0;
            let current = el2;
            while (current && current !== el1) {
              depth++;
              current = current.parentElement;
            }
            return depth;
          }
          
          if (el2.contains(el1)) {
            let depth = 0;
            let current = el1;
            while (current && current !== el2) {
              depth++;
              current = current.parentElement;
            }
            return depth;
          }
          
          // Find common ancestor
          const ancestors1 = [];
          let current = el1;
          while (current) {
            ancestors1.push(current);
            current = current.parentElement;
          }
          
          current = el2;
          let depth2 = 0;
          while (current) {
            const commonIndex = ancestors1.indexOf(current);
            if (commonIndex !== -1) {
              return commonIndex + depth2;
            }
            depth2++;
            current = current.parentElement;
          }
          
          return Infinity;
        }

        // STEP 1: Get product ID from config to find THE main product form
        const productId = window._RestockRocketConfig?.product?.id;
        const variantIds = window._RestockRocketConfig?.product?.variants?.map(v => v.id) || [];
        
        console.log('[DOM Extract] Product ID:', productId, 'Variant IDs:', variantIds);

        // STEP 2: Find main product container (multiple strategies)
        const mainProductContainer = 
          document.querySelector('product-info') ||
          document.querySelector('[id*="ProductInfo-"]') ||
          document.querySelector('.product__info-container') ||
          document.querySelector('.product__info-wrapper') ||
          document.querySelector('[class*="product"][class*="info"]');

        const mainProductContainerSelector = mainProductContainer ? getElementIdentifier(mainProductContainer) : null;
        console.log('[DOM Extract] Main product container:', mainProductContainerSelector || 'not detected');

        // STEP 3: Find THE main product form using product ID/variant ID
        let mainProductForm = null;
        
        if (productId || variantIds.length > 0) {
          const candidateForms = Array.from(document.querySelectorAll('form[action*="/cart/add"]'))
            .filter(form => {
              // Skip installment forms
              const formClass = String(form.className || '').toLowerCase();
              const formId = String(form.id || '').toLowerCase();
              if (formClass.includes('installment') || formId.includes('installment')) {
                return false;
              }
              return true;
            });

          // Find form with matching product ID
          mainProductForm = candidateForms.find(form => {
            // Check for product-id input
            const productIdInput = form.querySelector('input[name="product-id"]');
            if (productIdInput && productIdInput.value == productId) {
              console.log('[DOM Extract] ✅ Found main form via product-id input:', productId);
              return true;
            }
            
            // Check for variant input matching our variants
            const variantInput = form.querySelector('input[name="id"], select[name="id"]');
            if (variantInput) {
              const value = variantInput.value || variantInput.getAttribute('value');
              if (value && variantIds.includes(parseInt(value))) {
                console.log('[DOM Extract] ✅ Found main form via variant input:', value);
                return true;
              }
            }
            
            return false;
          });

          // Fallback: if we have mainProductContainer, find form inside it
          if (!mainProductForm && mainProductContainer) {
            mainProductForm = mainProductContainer.querySelector('form[action*="/cart/add"]');
            console.log('[DOM Extract] Using form from main product container as fallback');
          }
        }

        console.log('[DOM Extract] Main product form:', mainProductForm?.id || 'not found');

        // STEP 4: Extract all forms with context
        document.querySelectorAll('form').forEach(form => {
          // Skip installment forms
          const formClass = String(form.className || '').toLowerCase();
          const formId = String(form.id || '').toLowerCase();
          if (formClass.includes('installment') || formId.includes('installment')) {
            console.log('[DOM Extract] Skipping installment form:', formId);
            return;
          }
          
          const buttons = Array.from(form.querySelectorAll('button, input[type="submit"]')).map(btn => ({
            tag: btn.tagName.toLowerCase(),
            classes: btn.className,
            id: btn.id,
            name: btn.name,
            type: btn.type,
            text: btn.textContent?.trim().substring(0, 50),
          }));

          // Check if this is likely the product form
          const hasVariantInput = !!form.querySelector('[name="id"], [name="variant_id"], select[name="id"]');
          const hasQuantityInput = !!form.querySelector('[name="quantity"]');
          const hasAddAction = form.action?.includes('/cart/add');
          const isProductForm = hasVariantInput || hasAddAction;
          const isMainProductForm = form === mainProductForm;

          // Extract layout info for the main add to cart button
          let buttonLayoutInfo = null;
          const mainButton = form.querySelector('button[name="add"], button[type="submit"]:not([name="checkout"])');
          if (mainButton) {
            const parent = mainButton.parentElement;
            const grandparent = parent?.parentElement;
            const parentStyle = parent ? window.getComputedStyle(parent) : null;
            const grandparentStyle = grandparent ? window.getComputedStyle(grandparent) : null;

            buttonLayoutInfo = {
              button: {
                selector: getGenericSelector(mainButton),
                classes: mainButton.className,
                id: mainButton.id
              },
              parent: parent ? {
                selector: getGenericSelector(parent),
                tagName: parent.tagName.toLowerCase(),
                classes: parent.className,
                id: parent.id,
                isForm: parent.tagName.toLowerCase() === 'form',
                display: parentStyle.display,
                flexDirection: parentStyle.flexDirection,
                flexWrap: parentStyle.flexWrap,
                gridTemplateColumns: parentStyle.gridTemplateColumns
              } : null,
              grandparent: grandparent ? {
                selector: getGenericSelector(grandparent),
                tagName: grandparent.tagName.toLowerCase(),
                classes: grandparent.className,
                id: grandparent.id,
                isForm: grandparent.tagName.toLowerCase() === 'form',
                display: grandparentStyle.display,
                flexDirection: grandparentStyle.flexDirection,
                flexWrap: grandparentStyle.flexWrap,
                gridTemplateColumns: grandparentStyle.gridTemplateColumns
              } : null
            };
          }

          // Generate generic selector for this form
          const formGenericSelector = mainProductContainer && isMainProductForm
            ? getGenericSelector(form, mainProductContainer)
            : getGenericSelector(form);

          elements.push({
            type: 'form',
            classes: form.className,
            id: form.id,
            action: form.action,
            buttons: buttons,
            hasVariantInput: hasVariantInput,
            hasQuantityInput: hasQuantityInput,
            isProductForm: isProductForm,
            isMainProductForm: isMainProductForm,
            genericSelector: formGenericSelector,
            buttonLayoutInfo: buttonLayoutInfo
          });
        });
        
        // Helper function to generate simple selector (legacy - keep for compatibility)
        function getSimpleSelector(el) {
          if (!el) return '';
          let selector = el.tagName.toLowerCase();
          if (el.id && typeof el.id === 'string' && !el.id.match(/\d/)) {
            selector += '#' + el.id;
          } else if (el.className) {
            const classes = el.className.split(' ')
              .filter(c => c && !c.match(/\d/) && !c.includes('restock-rocket'))
              .slice(0, 2);
            if (classes.length > 0) {
              selector += '.' + classes.join('.');
            }
          }
          return selector;
        }

        // Find standalone buttons
        document.querySelectorAll('button:not(form button)').forEach(btn => {
          const text = btn.textContent?.trim().toLowerCase();
          if (text && (text.includes('add') || text.includes('buy') || text.includes('sold'))) {
            elements.push({
              type: 'button',
              classes: btn.className,
              id: btn.id,
              text: text.substring(0, 50),
            });
          }
        });

        // STEP 5: Find price elements and rank by distance from main form
        const allPriceElements = Array.from(document.querySelectorAll('[class*="price"], [data-price], [id*="price"]'));
        
        const priceElementsWithDistance = allPriceElements
          .map(priceEl => {
          const text = priceEl.textContent?.trim();
          // Only include if it looks like a price (has $ or currency)
            if (!text || !(text.includes('$') || text.includes('CAD') || text.includes('USD') || /\d+\.\d{2}/.test(text))) {
              return null;
            }
            
            // Calculate distance from main product form
            const distance = mainProductForm ? getDOMDistance(mainProductForm, priceEl) : Infinity;
            
            return {
              element: priceEl,
              distance: distance,
              classes: priceEl.className,
              id: priceEl.id,
              text: text.substring(0, 50)
            };
          })
          .filter(Boolean);
        
        // Sort by distance (closest first)
        priceElementsWithDistance.sort((a, b) => a.distance - b.distance);
        
        // Take top 8 closest price elements (likely all main product prices)
        const relevantPrices = priceElementsWithDistance.slice(0, 8);
        
        console.log('[DOM Extract] Found', relevantPrices.length, 'price elements near main form');
        
        relevantPrices.forEach((priceData, index) => {
          // Generate generic scoped selector
          const genericSelector = getGenericSelector(priceData.element, mainProductContainer);
          
          elements.push({
            type: 'price',
            classes: priceData.classes,
            id: priceData.id,
            text: priceData.text,
            genericSelector: genericSelector,
            distanceFromForm: priceData.distance,
            priority: index,  // 0 = highest priority (closest)
            isMainProductPrice: index === 0  // First one is THE price
          });
        });

        // Get minimal HTML structure
        const productArea = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
        const clone = productArea.cloneNode(true);
        
        // Aggressive cleanup
        clone.querySelectorAll(
          'script, style, img, svg, video, header, footer, nav, aside, ' +
          '[class*="header"], [class*="footer"], [class*="breadcrumb"], ' +
          '[class*="announcement"], [class*="cookie"], [class*="chat"], ' +
          '[class*="review"], [class*="related"]'
        ).forEach(el => el.remove());

        clone.querySelectorAll('*').forEach(el => {
          if (!['BUTTON', 'LABEL', 'A', 'FORM', 'INPUT', 'SELECT'].includes(el.tagName)) {
            el.textContent = '';
          } else if (el.textContent) {
            el.textContent = el.textContent.trim().substring(0, 30);
          }
          
          const keep = ['class', 'id', 'name', 'type', 'action', 'for'];
          Array.from(el.attributes).forEach(attr => {
            if (!keep.includes(attr.name)) el.removeAttribute(attr.name);
          });
        });

        let minimalHTML = clone.outerHTML
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/\s+/g, ' ')
          .replace(/>\s+</g, '><')
          .substring(0, 30000);

        // Detect page type from window._RestockRocketConfig or URL
        let pageType = 'product'; // default
        
        // Wait for config to be available (up to 1 second)
        let attempts = 0;
        while (!window._RestockRocketConfig?.pageType && attempts < 5) {
          await new Promise(resolve => setTimeout(resolve, 200));
          attempts++;
        }
        
        if (window._RestockRocketConfig?.pageType) {
          pageType = window._RestockRocketConfig.pageType;
        } else {
          // Fallback: detect from URL pattern
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

        const extracted = {
          url: window.location.href,
          title: document.title,
          elements: elements,
          minimalHTML: minimalHTML,
          pageType: pageType,
          mainProductArea: {
            detected: !!mainProductContainer,
            selector: mainProductContainerSelector,
            hasMainForm: !!mainProductForm,
            productId: productId
          }
        };
        
        const domContent = JSON.stringify(extracted);
        sendResponse({ success: true, domContent });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true; // Keep channel open for async response
    }
    
    if (message.type === 'highlight') {
      // Simple highlight without validation
      try {
        const element = document.querySelector(message.selector);
        if (element) {
          const originalOutline = element.style.outline;
          element.style.outline = '3px solid #6366f1';
          element.style.outlineOffset = '2px';
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          setTimeout(() => {
            element.style.outline = originalOutline;
          }, 3000);
          
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Element not found' });
        }
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return true;
    }
    
    // getSettingId is now handled via chrome.scripting.executeScript in adminSync.js
    // (removed to avoid CSP issues with inline script injection)
    
    if (message.type === 'fillAdminForm') {
      // Fill admin form fields with selectors
      (async () => {
        try {
          const fields = message.fields;
          let filledCount = 0;
          const results = [];
          
          for (const field of fields) {
            console.log(`[AdminSync] Looking for field: ${field.fieldId}`, field);
            const input = document.getElementById(field.fieldId);
            
            if (input) {
              console.log(`[AdminSync] Found field ${field.fieldId}, current value:`, input.value);
              
              // Scroll to field
              input.scrollIntoView({ behavior: 'smooth', block: 'center' });
              
              // Highlight briefly
              input.style.border = '2px solid #6366f1';
              input.style.transition = 'border 0.3s';
              
              // Wait a bit for visual feedback
              await new Promise(resolve => setTimeout(resolve, 500));
              
              // Fill value - try multiple approaches
              input.value = field.value;
              input.setAttribute('value', field.value);
              
              // Trigger multiple events to ensure frameworks pick it up
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('blur', { bubbles: true }));
              
              console.log(`[AdminSync] Filled field ${field.fieldId} with:`, field.value);
              console.log(`[AdminSync] Verify - field value is now:`, input.value);
              
              // Reset border
              setTimeout(() => {
                input.style.border = '';
              }, 1000);
              
              filledCount++;
              results.push({ fieldId: field.fieldId, success: true, value: field.value });
            } else {
              console.error(`[AdminSync] Field not found: ${field.fieldId}`);
              results.push({ fieldId: field.fieldId, success: false, error: 'Field not found' });
            }
          }
          
          console.log(`[AdminSync] Fill complete. Filled ${filledCount}/${fields.length} fields`, results);
          sendResponse({ success: true, filledCount, results });
        } catch (error) {
          console.error('[AdminSync] Error filling form:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }
    
    if (message.type === 'saveSettingsViaAPI') {
      // Save settings via API instead of form filling
      (async () => {
        try {
          console.log('[AdminSync] Saving settings via API...', message.payload);
          
          const response = await fetch('/setting', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify(message.payload),
            credentials: 'same-origin', // Use browser's cookies/session
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('[AdminSync] API error:', response.status, errorText);
            sendResponse({ success: false, error: `API error: ${response.status}` });
            return;
          }

          const data = await response.json();
          console.log('[AdminSync] Settings saved successfully!', data);
          sendResponse({ success: true, data });
        } catch (error) {
          console.error('[AdminSync] Error saving via API:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }

    if (message.type === 'clickSaveButton') {
      // Click the "Save and edit" button in admin (stays on page instead of redirecting)
      (async () => {
        try {
          const saveButton = document.querySelector('button[name="_add_edit"]');
          if (saveButton) {
            console.log('[AdminSync] Clicking "Save and edit" button...');
            saveButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await new Promise(resolve => setTimeout(resolve, 500));
            saveButton.click();
            console.log('[AdminSync] Save button clicked!');
            sendResponse({ success: true });
          } else {
            console.error('[AdminSync] Save and edit button not found');
            sendResponse({ success: false, error: 'Save button not found' });
          }
        } catch (error) {
          console.error('[AdminSync] Error clicking save button:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }

    if (message.type === 'simulateNotifyMe') {
      // Simulate notify me button placement on ALL matching elements
      (async () => {
        try {
          const { selector, insertType } = message;
          
          // Remove any existing simulation
          document.querySelectorAll('.notify-me-simulation').forEach(el => el.remove());
          document.querySelectorAll('.notify-me-simulation-style').forEach(el => el.remove());

          // Find ALL target elements (not just first)
          const targetEls = document.querySelectorAll(selector);
          
          if (targetEls.length === 0) {
            sendResponse({ success: false, error: 'Element not found on page' });
            return;
          }

          console.log(`Found ${targetEls.length} matching elements for: ${selector}`);

          // Add animation style
          const style = document.createElement('style');
          style.className = 'notify-me-simulation-style';
          style.textContent = `
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.7; }
            }
          `;
          document.head.appendChild(style);

          // Track borders to restore
          const originalBorders = [];

          // Insert simulation at each match
          targetEls.forEach((targetEl, index) => {
            // Create simulation button
            const simulationBtn = document.createElement('div');
            simulationBtn.className = 'notify-me-simulation';
            
            const countBadge = targetEls.length > 1 ? ` <span style="background: #ef4444; padding: 2px 6px; border-radius: 4px; font-size: 10px;">${index + 1}/${targetEls.length}</span>` : '';
            
            simulationBtn.innerHTML = `
              <div style="
                background: #000;
                color: white;
                padding: 10px 16px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 600;
                margin: 8px 0;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                border: 2px dashed #4ade80;
                animation: pulse 2s infinite;
              ">
                🔔 Notify me when available (PREVIEW)${countBadge}
              </div>
            `;

            // Insert based on type
            targetEl.insertAdjacentElement(insertType, simulationBtn);

            // Highlight target element
            originalBorders.push({ el: targetEl, border: targetEl.style.border });
            targetEl.style.border = '2px solid #4ade80';
            targetEl.style.transition = 'border 0.3s';
          });

          // Scroll to first match
          targetEls[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

          // Store original borders for cleanup
          window._simulationCleanup = {
            borders: originalBorders,
            style: style,
            type: 'notify-me'
          };

          sendResponse({ 
            success: true, 
            count: targetEls.length,
            warning: targetEls.length > 1 ? `Selector matches ${targetEls.length} elements. Consider making it more specific.` : null
          });
        } catch (error) {
          console.error('Simulation error:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }

    if (message.type === 'simulatePreorderSetup') {
      // Simulate complete preorder setup with all elements
      (async () => {
        try {
          const { buttonSelectors, positionSelectors } = message;
          
          // Remove any existing simulations
          document.querySelectorAll('.preorder-simulation').forEach(el => el.remove());
          document.querySelectorAll('.preorder-simulation-style').forEach(el => el.remove());

          // Find form and button - skip installment forms
          const formSelector = buttonSelectors?.form?.recommended;
          const allForms = document.querySelectorAll(formSelector);
          let form = null;
          
          // Find first non-installment form
          for (const f of allForms) {
            const fClass = String(f.className || '').toLowerCase();
            const fId = String(f.id || '').toLowerCase();
            if (!fClass.includes('installment') && !fId.includes('installment')) {
              form = f;
              console.log('[Simulation] Using form:', fId || fClass);
              break;
            } else {
              console.log('[Simulation] Skipping installment form:', fId);
            }
          }
          
          if (!form) {
            sendResponse({ success: false, error: 'Product form not found (only found installment forms)' });
            return;
          }
          
          const button = document.querySelector(buttonSelectors?.addToCart?.recommended);
          if (!button) {
            sendResponse({ success: false, error: 'Button not found' });
            return;
          }

          console.log('[Simulation] Form found:', form);
          console.log('[Simulation] Button found:', button);
          console.log('[Simulation] Form selector used:', buttonSelectors?.form?.recommended);

          // Add CSS for simulations
          const style = document.createElement('style');
          style.className = 'preorder-simulation-style';
          style.textContent = `
            .preorder-simulation {
              border: 2px dashed #4ade80 !important;
              background: rgba(74, 222, 128, 0.1) !important;
              animation: preorderPulse 2s infinite;
            }
            @keyframes preorderPulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.8; }
            }
            .preorder-sim-label {
              background: #000;
              color: #4ade80;
              font-size: 10px;
              padding: 2px 6px;
              border-radius: 3px;
              font-weight: 600;
              display: inline-block;
              margin-right: 4px;
            }
          `;
          document.head.appendChild(style);

          let elementsAdded = 0;

          // Simulate payment widget (above button)
          if (positionSelectors?.paymentWidget?.recommended) {
            const paymentTarget = document.querySelector(positionSelectors.paymentWidget.recommended.selector);
            if (paymentTarget) {
              const paymentSim = document.createElement('div');
              paymentSim.className = 'preorder-simulation';
              paymentSim.style.cssText = 'padding: 10px; margin: 8px 0; border-radius: 6px;';
              paymentSim.innerHTML = '<span class="preorder-sim-label">💳 PAYMENT WIDGET</span> Pay now / Pay later options';
              paymentTarget.insertAdjacentElement(positionSelectors.paymentWidget.recommended.insertType, paymentSim);
              elementsAdded++;
            }
          }

          // Simulate progress bar
          if (positionSelectors?.progressBar?.recommended) {
            const progressTarget = document.querySelector(positionSelectors.progressBar.recommended.selector);
            if (progressTarget) {
              const progressSim = document.createElement('div');
              progressSim.className = 'preorder-simulation';
              progressSim.style.cssText = 'padding: 10px; margin: 8px 0; border-radius: 6px;';
              progressSim.innerHTML = '<span class="preorder-sim-label">📊 PROGRESS</span> 15 of 20 sold';
              progressTarget.insertAdjacentElement(positionSelectors.progressBar.recommended.insertType, progressSim);
              elementsAdded++;
            }
          }

          // Simulate acknowledgement checkbox
          if (positionSelectors?.acknowledgement?.recommended) {
            const ackTarget = document.querySelector(positionSelectors.acknowledgement.recommended.selector);
            if (ackTarget) {
              const ackSim = document.createElement('div');
              ackSim.className = 'preorder-simulation';
              ackSim.style.cssText = 'padding: 10px; margin: 8px 0; border-radius: 6px;';
              ackSim.innerHTML = '<span class="preorder-sim-label">✅ TERMS</span> ☑ I agree to preorder terms';
              ackTarget.insertAdjacentElement(positionSelectors.acknowledgement.recommended.insertType, ackSim);
              elementsAdded++;
            }
          }

          // Highlight the button itself
          button.style.border = '3px solid #f59e0b';
          button.style.transition = 'border 0.3s';
          const originalButtonBorder = button.style.border;

          // Simulate button text change
          let originalButtonText = '';
          let buttonTextElement = button;
          
          if (buttonSelectors?.buttonChild?.recommended) {
            const childElement = button.querySelector(buttonSelectors.buttonChild.recommended);
            if (childElement) {
              buttonTextElement = childElement;
            }
          }
          
          // Store original styles BEFORE changing
          const originalButtonBgColor = buttonTextElement.style.backgroundColor;
          
          // Store original text
          if (buttonTextElement.tagName.toLowerCase() === 'input') {
            originalButtonText = buttonTextElement.value;
            buttonTextElement.value = '✨ PREORDER NOW';
          } else {
            originalButtonText = buttonTextElement.innerHTML;
            buttonTextElement.innerHTML = '✨ PREORDER NOW';
          }
          
          // Add visual indicator that text was changed
          buttonTextElement.style.backgroundColor = 'rgba(245, 158, 11, 0.1)';
          buttonTextElement.style.transition = 'background-color 0.3s';

          // Simulate disclaimer (after button)
          if (positionSelectors?.disclaimer?.recommended) {
            const disclaimerTarget = document.querySelector(positionSelectors.disclaimer.recommended.selector);
            if (disclaimerTarget) {
              const disclaimerSim = document.createElement('div');
              disclaimerSim.className = 'preorder-simulation';
              disclaimerSim.style.cssText = 'padding: 10px; margin: 8px 0; border-radius: 6px;';
              disclaimerSim.innerHTML = '<span class="preorder-sim-label">📝 DISCLAIMER</span> Ships Jan 15, 2025 • Preorder now';
              disclaimerTarget.insertAdjacentElement(positionSelectors.disclaimer.recommended.insertType, disclaimerSim);
              elementsAdded++;
            }
          }

          // Simulate countdown (goes after disclaimer, so same button with afterend)
          if (positionSelectors?.countdown?.recommended) {
            const countdownTarget = document.querySelector(positionSelectors.countdown.recommended.selector);
            if (countdownTarget) {
              // Find the disclaimer simulation and insert after it, otherwise use button
              const disclaimerSim = Array.from(document.querySelectorAll('.preorder-simulation')).find(el => 
                el.textContent.includes('DISCLAIMER')
              );
              
              const countdownSim = document.createElement('div');
              countdownSim.className = 'preorder-simulation';
              countdownSim.style.cssText = 'padding: 10px; margin: 8px 0; border-radius: 6px;';
              countdownSim.innerHTML = '<span class="preorder-sim-label">⏰ COUNTDOWN</span> Offer ends in 3 days';
              
              if (disclaimerSim) {
                disclaimerSim.insertAdjacentElement('afterend', countdownSim);
              } else {
                countdownTarget.insertAdjacentElement(positionSelectors.countdown.recommended.insertType, countdownSim);
              }
              elementsAdded++;
            }
          }

          // Simulate badge (at price/title)
          if (positionSelectors?.badge?.recommended) {
            const badgeTarget = document.querySelector(positionSelectors.badge.recommended.selector);
            if (badgeTarget) {
              const badgeSim = document.createElement('div');
              badgeSim.className = 'preorder-simulation';
              badgeSim.style.cssText = 'padding: 4px 8px; margin: 4px 0; display: inline-block; border-radius: 4px; font-size: 11px; font-weight: 600;';
              badgeSim.innerHTML = '<span class="preorder-sim-label">🏷️</span> PREORDER';
              badgeTarget.insertAdjacentElement(positionSelectors.badge.recommended.insertType, badgeSim);
              elementsAdded++;
            }
          }

          // Simulate discounted price
          if (positionSelectors?.discountedPrice?.recommended) {
            const priceTarget = document.querySelector(positionSelectors.discountedPrice.recommended.selector);
            if (priceTarget) {
              const priceSim = document.createElement('div');
              priceSim.className = 'preorder-simulation';
              priceSim.style.cssText = 'padding: 6px 10px; margin: 4px 0; display: inline-block; border-radius: 4px; font-size: 12px; font-weight: 600;';
              priceSim.innerHTML = '<span class="preorder-sim-label">💰 DISCOUNTED</span> <s style="color: #999;">$11.00</s> $8.80';
              priceTarget.insertAdjacentElement(positionSelectors.discountedPrice.recommended.insertType, priceSim);
              elementsAdded++;
            }
          }

          // Simulate form modifications (hidden inputs)
          const formSim = document.createElement('div');
          formSim.className = 'preorder-simulation';
          formSim.style.cssText = 'padding: 12px; margin: 8px 0; border-radius: 6px; font-size: 11px; font-family: monospace;';
          formSim.innerHTML = `
            <span class="preorder-sim-label">📋 FORM UPDATES</span>
            <div style="margin-top: 6px; color: #666;">
              • <input type="hidden" name="selling_plan" value="123456"><br>
              • properties[Shipping]: "Ships Jan 15"<br>
              • properties[Payment]: "Deposit 50%"<br>
              • attributes[__stoq_data]: tracking data
            </div>
          `;
          form.insertAdjacentElement('afterend', formSim);
          
          // Make form highly visible with thick border and label
          const originalFormBorder = form.style.border;
          const originalFormBoxShadow = form.style.boxShadow;
          form.style.border = '4px solid #4ade80';
          form.style.boxShadow = '0 0 0 2px rgba(74, 222, 128, 0.2)';
          form.style.position = 'relative';
          
          // Add label to form
          const formLabel = document.createElement('div');
          formLabel.className = 'preorder-simulation';
          formLabel.style.cssText = `
            position: absolute;
            top: -12px;
            left: 10px;
            background: #4ade80;
            color: #000;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 700;
            z-index: 10000;
          `;
          formLabel.textContent = '📋 TARGET FORM';
          form.style.position = 'relative';
          form.appendChild(formLabel);
          
          elementsAdded++;

          // Store cleanup data
          window._simulationCleanup = {
            button: { el: button, border: originalButtonBorder },
            buttonText: { el: buttonTextElement, text: originalButtonText, bgColor: originalButtonBgColor },
            form: { el: form, border: originalFormBorder, boxShadow: originalFormBoxShadow },
            style: style,
            type: 'preorder'
          };

          // Highlight original price element (will be strikethrough)
          const originalPriceSelector = buttonSelectors?.originalPrice?.recommended;
          if (originalPriceSelector) {
            const originalPriceEl = document.querySelector(originalPriceSelector);
            if (originalPriceEl) {
              const origBorder = originalPriceEl.style.border;
              const origPadding = originalPriceEl.style.padding;
              originalPriceEl.style.border = '2px dashed #ef4444';
              originalPriceEl.style.padding = '2px';
              originalPriceEl.style.borderRadius = '3px';
              
              // Store for cleanup
              window._simulationCleanup.originalPrice = { el: originalPriceEl, border: origBorder, padding: origPadding };
              elementsAdded++;
            }
          }

          // Scroll to button to see the full setup
          button.scrollIntoView({ behavior: 'smooth', block: 'center' });

          sendResponse({ success: true, elementsAdded });
        } catch (error) {
          console.error('Preorder simulation error:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }

    if (message.type === 'clearSimulation') {
      // Clear all simulations
      try {
        document.querySelectorAll('.notify-me-simulation').forEach(el => el.remove());
        document.querySelectorAll('.preorder-simulation').forEach(el => el.remove());
        document.querySelectorAll('.notify-me-simulation-style').forEach(el => el.remove());
        document.querySelectorAll('.preorder-simulation-style').forEach(el => el.remove());

        // Remove all green/orange borders from highlighted elements
        document.querySelectorAll('*').forEach(el => {
          const border = el.style.border;
          if (border && (border.includes('#4ade80') || border.includes('#f59e0b') || border.includes('rgb(74, 222, 128)') || border.includes('rgb(245, 158, 11)'))) {
            el.style.border = '';
            el.style.boxShadow = '';
            el.style.transition = '';
          }
        });

        // Restore original borders and text
        if (window._simulationCleanup) {
          if (window._simulationCleanup.borders) {
            window._simulationCleanup.borders.forEach(({ el, border }) => {
              el.style.border = border;
            });
          }
          if (window._simulationCleanup.button) {
            window._simulationCleanup.button.el.style.border = window._simulationCleanup.button.border;
          }
          if (window._simulationCleanup.buttonText) {
            const textEl = window._simulationCleanup.buttonText.el;
            if (textEl.tagName.toLowerCase() === 'input') {
              textEl.value = window._simulationCleanup.buttonText.text;
            } else {
              textEl.innerHTML = window._simulationCleanup.buttonText.text;
            }
            textEl.style.backgroundColor = window._simulationCleanup.buttonText.bgColor;
          }
          if (window._simulationCleanup.form) {
            window._simulationCleanup.form.el.style.border = window._simulationCleanup.form.border;
            window._simulationCleanup.form.el.style.boxShadow = window._simulationCleanup.form.boxShadow;
          }
          if (window._simulationCleanup.originalPrice) {
            window._simulationCleanup.originalPrice.el.style.border = window._simulationCleanup.originalPrice.border;
            window._simulationCleanup.originalPrice.el.style.padding = window._simulationCleanup.originalPrice.padding;
          }
          if (window._simulationCleanup.style) {
            window._simulationCleanup.style.remove();
          }
          window._simulationCleanup = null;
        }

        sendResponse({ success: true });
      } catch (error) {
        console.error('Clear simulation error:', error);
        sendResponse({ success: false, error: error.message });
      }
      return true;
    }
  });

  // Add near the top of your IIFE
  window.addEventListener('reinitButtonFinder', init);

  function init() {
    removeExistingHighlights();
    injectStyles();
    setTimeout(lookForButtons, 100);
  }

  function removeExistingHighlights() {
    document.querySelectorAll(".highlighted-button").forEach((el) => {
      el.classList.remove("highlighted-button");
      const existingLabel = el.nextSibling;
      if (existingLabel?.classList.contains("selector-container")) {
        existingLabel.remove();
      }
    });
  }

  function injectStyles() {
    chrome.storage.sync.get(['highlightColor'], (settings) => {
      const style = document.createElement('style');
      style.textContent = `
        .highlighted-button {
          outline: 5px dashed ${settings.highlightColor || 'red'} !important;
          outline-offset: 2px;
          position: relative;
        }
      `;
      document.head.appendChild(style);
    });
  }

  function lookForButtons() {
    buttonSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((button) => {
        if (!button.classList.contains("highlighted-button") && !shouldIgnoreElement(button)) {
          highlightButton(button);
        }
      });
    });
  }

  function highlightButton(button) {
    button.classList.add("highlighted-button");
    const infoButton = createInfoButton();
    const container = createContainerWithSelectors(button, infoButton);
    
    // Create a wrapper for the info button
    const infoWrapper = document.createElement('div');
    infoWrapper.style.position = 'absolute';
    infoWrapper.style.zIndex = '999999';
    infoWrapper.appendChild(infoButton);
    
    // Position the wrapper relative to the button
    const rect = button.getBoundingClientRect();
    infoWrapper.style.top = `${rect.top + window.scrollY - 10}px`;
    infoWrapper.style.left = `${rect.right + 5}px`;
    
    document.body.appendChild(infoWrapper);
    document.body.appendChild(container);
  }

  function createInfoButton() {
    const infoButton = document.createElement("div");
    infoButton.className = "selector-info-button";
    infoButton.textContent = "i";
    return infoButton;
  }

  function setupInfoButtonHandler(button, container, infoButton) {
    infoButton.addEventListener("click", (e) => {
      e.preventDefault();
      stopEvent(e);
      
      // Close any other open containers
      document.querySelectorAll(".selector-info-button.active").forEach(el => {
        if (el !== infoButton) {
          el.classList.remove("active");
          const otherContainer = document.querySelector(`[data-for-button="${el.dataset.buttonId}"]`);
          if (otherContainer) otherContainer.style.display = "none";
        }
      });
      
      infoButton.classList.toggle("active");
      if (infoButton.classList.contains("active")) {
        container.style.display = "block";
        positionContainer(button, container);
      } else {
        container.style.display = "none";
      }
    });
  }

  function createContainerWithSelectors(button, infoButton) {
    const container = document.createElement("div");
    container.className = "selector-container";
    container.style.display = "none";

    // Add drag handle
    const dragHandle = document.createElement("div");
    dragHandle.className = "drag-handle";
    dragHandle.innerHTML = `
        <button class="reposition-button">Reposition</button>
    `;
    // container.appendChild(dragHandle);

    // Add drag functionality
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    dragHandle.querySelector('.reposition-button').addEventListener('click', () => {
        dragHandle.classList.toggle('active');
    });

    dragHandle.addEventListener('mousedown', (e) => {
        if (!dragHandle.classList.contains('active')) return;
        
        isDragging = true;
        container.style.transition = 'none';
        
        initialX = e.clientX - container.offsetLeft;
        initialY = e.clientY - container.offsetTop;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;
        
        container.style.left = `${currentX}px`;
        container.style.top = `${currentY}px`;
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        container.style.transition = '';
    });

    // Find Shopify data script and extract data using regex
    const scripts = document.getElementsByTagName('script');
    let shopifyData = null;
    
    for (const script of scripts) {
        const content = script.textContent || '';
        if (content.includes('Shopify.theme')) {
            const nameMatch = content.match(/schema_name":\s*"([^"]+)"/);
            const versionMatch = content.match(/schema_version":\s*"([^"]+)"/);
            
            if (nameMatch && versionMatch) {
                shopifyData = {
                    schema_name: nameMatch[1],
                    schema_version: versionMatch[1]
                };
            }
            break;
        }
    }

    // Add theme info in one line
    if (shopifyData) {
        const themeRow = document.createElement("div");
        themeRow.className = "selector-row theme-info";
        themeRow.innerHTML = `
            <div class="theme-details">
              <span class="theme-name">${shopifyData.schema_name}</span>
              <span class="theme-version">v${shopifyData.schema_version}</span>
            </div>
        `;
        container.appendChild(themeRow);
    }

    // Add notify me simulation controls
    const notifySimulation = document.createElement("div");
    notifySimulation.className = "simulation-controls";
    notifySimulation.innerHTML = `
      <div class="simulation-heading">Notify Me Button Simulation</div>
      <div class="simulation-inputs">
        <input type="text" class="selector-input" placeholder="Enter selector">
        <div class="simulation-buttons">
          <select class="position-select">
            <option value="afterend" selected>After element</option>
            <option value="beforebegin">Before element</option>
            <option value="afterbegin">Start of element</option>
            <option value="beforeend">End of element</option>
          </select>
          <button class="simulate-button">Simulate</button>
          <button class="clear-button">Clear</button>
        </div>
      </div>
    `;

    // Add preorder simulation controls
    const preorderSimulation = document.createElement("div");
    preorderSimulation.className = "simulation-controls preorder-simulation";
    preorderSimulation.innerHTML = `
      <div class="simulation-heading">Preorder Button Simulation</div>
      <div class="simulation-inputs">
        <input type="text" class="button-selector" placeholder="Button selector">
        <input type="text" class="text-selector" placeholder="Text element selector" value="span">
      </div>
      <div class="simulation-buttons">
        <button class="simulate-button">Simulate</button>
        <button class="clear-button">Clear</button>
      </div>
    `;

    // Add event listeners for notify me simulation
    const notifyInput = notifySimulation.querySelector('.selector-input');
    const positionSelect = notifySimulation.querySelector('.position-select');
    const notifySimulateBtn = notifySimulation.querySelector('.simulate-button');
    const notifyClearBtn = notifySimulation.querySelector('.clear-button');

    notifySimulateBtn.addEventListener('click', () => {
      SimulationService.simulate(notifyInput.value, positionSelect.value);
    });

    notifyClearBtn.addEventListener('click', () => {
      SimulationService.clear();
    });

    // Add event listeners for preorder simulation
    const buttonSelector = preorderSimulation.querySelector('.button-selector');
    const textSelector = preorderSimulation.querySelector('.text-selector');
    const preorderSimulateBtn = preorderSimulation.querySelector('.simulate-button');
    const preorderClearBtn = preorderSimulation.querySelector('.clear-button');

    preorderSimulateBtn.addEventListener('click', () => {
      if (!buttonSelector.value) {
        buttonSelector.style.borderColor = 'red';
        return;
      }
      if (!textSelector.value) {
        textSelector.style.borderColor = 'red';
        return;
      }
      const button = document.querySelector(buttonSelector.value);
      if (!button) {
        buttonSelector.style.borderColor = 'red';
        return;
      }
      
      const textElement = button.querySelector(textSelector.value);
      if (!textElement) {
        textSelector.style.borderColor = 'red';
        return;
      }

      textElement.textContent = 'Pre-order';
      buttonSelector.style.borderColor = '';
      textSelector.style.borderColor = '';
    });

    preorderClearBtn.addEventListener('click', () => {
      const button = document.querySelector(buttonSelector.value);
      if (button) {
        const textElement = button.querySelector(textSelector.value);
        if (textElement) {
          textElement.textContent = textElement.dataset.originalText || 'Add to Cart';
        }
      }
    });

    container.appendChild(notifySimulation);
    container.appendChild(preorderSimulation);

    const closeBtn = createCloseButton(container, infoButton);
    const table = createTableOfSelectors(button);
    
    container.appendChild(closeBtn);
    container.appendChild(table);
    
    setupInfoButtonHandler(button, container, infoButton);
    
    return container;
  }

  function createCloseButton(container, infoButton) {
    const controlsDiv = document.createElement("div");
    controlsDiv.className = "selector-controls";
    
    const repositionBtn = document.createElement("span");
    repositionBtn.className = "selector-reposition";
    repositionBtn.textContent = "Move";
    
    const closeBtn = document.createElement("span");
    closeBtn.className = "selector-close";
    closeBtn.textContent = "×";
    
    // Add dragging functionality
    let isDragging = false;
    let initialX, initialY;
    
    repositionBtn.addEventListener("click", (e) => {
        stopEvent(e);
        repositionBtn.classList.toggle("active");
        repositionBtn.textContent = repositionBtn.classList.contains("active") ? "Moving" : "Move";
    });
    
    // Add mouse events for dragging
    container.addEventListener("mousedown", (e) => {
        if (!repositionBtn.classList.contains("active")) return;
        
        isDragging = true;
        initialX = e.clientX - container.offsetLeft;
        initialY = e.clientY - container.offsetTop;
        container.style.cursor = "move";
    });
    
    document.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        
        e.preventDefault();
        container.style.left = `${e.clientX - initialX}px`;
        container.style.top = `${e.clientY - initialY}px`;
    });
    
    document.addEventListener("mouseup", () => {
        isDragging = false;
        container.style.cursor = "default";
    });
    
    closeBtn.addEventListener("click", (e) => {
        stopEvent(e);
        container.style.display = "none";
        infoButton.classList.remove("active");
    });
    
    controlsDiv.appendChild(repositionBtn);
    controlsDiv.appendChild(closeBtn);
    return controlsDiv;
  }

  function createTableOfSelectors(button) {
    const table = document.createElement("div");
    table.className = "selector-table";
    
    // Main button selector
    table.appendChild(addButtonSelectorRow(button));
    
    // Parent selectors
    addButtonWithParentSelectorRows(table, button);
    
    // Inner elements section (collapsed by default)
    const innerElementsRow = document.createElement("div");
    innerElementsRow.className = "selector-row inner-elements-header";
    
    const headerContent = document.createElement("div");
    headerContent.className = "selector-content";
    
    const label = document.createElement("div");
    label.className = "selector-label";
    label.textContent = "Button - Inner Elements";
    
    const showButton = document.createElement("div");
    showButton.className = "show-elements-button";
    showButton.textContent = "Show";
    
    headerContent.appendChild(label);
    headerContent.appendChild(showButton);
    innerElementsRow.appendChild(headerContent);
    
    // Collapsible inner elements container
    const innerElementsContainer = document.createElement("div");
    innerElementsContainer.className = "inner-elements-container";
    innerElementsContainer.style.display = 'none'; // Start hidden
    
    // Get all inner elements
    const elements = Array.from(button.getElementsByTagName('*'));
    elements.forEach((element) => {
        const row = document.createElement("div");
        row.className = "inner-element-row";
        
        const elementContent = document.createElement("div");
        elementContent.className = "element-content";
        
        const elementInfo = document.createElement("div");
        elementInfo.className = "element-info";
        elementInfo.textContent = `${element.tagName.toLowerCase()}${element.textContent.trim() ? ` (${element.textContent.trim().substring(0, 20)}${element.textContent.trim().length > 20 ? '...' : ''})` : ''}`;
        
        const elementSelector = document.createElement("div");
        elementSelector.className = "element-selector";
        elementSelector.textContent = getElementSelector(element);
        
        const copyButton = createCopyButton(getElementSelector(element));
        
        elementContent.appendChild(elementInfo);
        elementContent.appendChild(elementSelector);
        elementContent.appendChild(copyButton);
        row.appendChild(elementContent);
        
        innerElementsContainer.appendChild(row);
    });
    
    // Toggle inner elements visibility
    showButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isHidden = innerElementsContainer.style.display === 'none';
        innerElementsContainer.style.display = isHidden ? 'block' : 'none';
        showButton.textContent = isHidden ? 'Hide' : 'Show';
    });
    
    table.appendChild(innerElementsRow);
    table.appendChild(innerElementsContainer);
    
    return table;
  }

  function createInnerElementLabel(elementInfo) {
    const group = document.createElement("div");
    group.className = "selector-label-group";

    // Create main row with element info and expand button
    const mainRow = document.createElement("div");
    mainRow.className = "element-main-row";
    
    const label = document.createElement("div");
    label.className = "selector-label";
    let labelText = elementInfo.tag;
    if (elementInfo.text) {
        labelText += ` (${elementInfo.text.substring(0, 20)}${elementInfo.text.length > 20 ? '...' : ''})`;
    }
    label.textContent = labelText;

    const expandButton = document.createElement("div");
    expandButton.className = "expand-button";
    expandButton.textContent = "▼";
    expandButton.title = "Show selector";
    
    mainRow.appendChild(label);
    mainRow.appendChild(expandButton);
    
    // Create collapsible section with selector
    const selectorSection = document.createElement("div");
    selectorSection.className = "selector-section collapsed";
    
    const text = document.createElement("div");
    text.className = "selector-text";
    text.textContent = elementInfo.selector;

    const copyButton = createCopyButton(elementInfo.selector);
    copyButton.className = "copy-button small";
    
    selectorSection.appendChild(text);
    selectorSection.appendChild(copyButton);
    
    // Add click handler for expand/collapse
    expandButton.addEventListener('click', () => {
        selectorSection.classList.toggle('collapsed');
        expandButton.textContent = selectorSection.classList.contains('collapsed') ? "▼" : "▲";
    });

    group.appendChild(mainRow);
    group.appendChild(selectorSection);
    return group;
  }

  function getElementSelector(element) {
    let selector = element.tagName.toLowerCase();
    
    if (element.classList.length > 0) {
        const validClasses = Array.from(element.classList)
            .filter(cls => 
                !cls.match(/.*\d+.*/) && 
                cls !== 'highlighted-button' &&
                !['btn', 'button', 'button--full-width'].includes(cls.toLowerCase())
            );
        
        if (validClasses.length > 0) {
            selector += '.' + validClasses.join('.');
        }
    }
    
    return selector;
  }

  function addButtonSelectorRow(button) {
    const buttonRow = document.createElement("div");
    buttonRow.className = "selector-row";
    
    const contentDiv = document.createElement("div");
    contentDiv.className = "selector-content";
    
    const labelGroup = createLabelGroup("Button", getSelector(button));
    const buttonGroup = createCopyButton(getSelector(button), true);
    
    contentDiv.appendChild(labelGroup);
    contentDiv.appendChild(buttonGroup);
    buttonRow.appendChild(contentDiv);
    
    return buttonRow;
  }

  function createLabelGroup(labelText, selectorText) {
    const group = document.createElement("div");
    group.className = "selector-label-group";

    const label = document.createElement("div");
    label.className = "selector-label";
    label.textContent = labelText;

    const text = document.createElement("div");
    text.className = "selector-text";
    text.textContent = selectorText;

    group.appendChild(label);
    group.appendChild(text);
    return group;
  }

  function addButtonWithParentSelectorRows(table, button) {
    let parentElement = button.parentElement;
    for (let i = 1; i < 3 && parentElement; i++) {
      const row = addButtonWithParentSelectorRow(i, button, parentElement);
      table.appendChild(row);
      parentElement = parentElement.parentElement;
    }
  }

  function addButtonWithParentSelectorRow(index, button, parent) {
    const row = document.createElement("div");
    row.className = "selector-row";
    
    const contentDiv = document.createElement("div");
    contentDiv.className = "selector-content";
    
    const selector = getParentButtonSelector(button, parent);
    const labelGroup = createLabelGroup(`Button + Parent ${index}`, selector);
    const buttonGroup = createCopyButton(selector, true);
    
    contentDiv.appendChild(labelGroup);
    contentDiv.appendChild(buttonGroup);
    row.appendChild(contentDiv);
    
    return row;
  }

  function createCopyButton(textToCopy, addSimulate = false) {
    const buttonGroup = document.createElement("div");
    buttonGroup.className = "copy-simulate-group";
    
    const copyButton = document.createElement("div");
    copyButton.className = "copy-button";
    copyButton.role = "button";
    copyButton.textContent = "Copy";
    
    copyButton.addEventListener("click", (event) => {
      stopEvent(event);
      navigator.clipboard.writeText(textToCopy).then(() => {
        copyButton.textContent = "Copied!";
        setTimeout(() => (copyButton.textContent = "Copy"), 1000);
      });
    });

    buttonGroup.appendChild(copyButton);

    if (addSimulate) {
      const simulateButton = document.createElement("div");
      simulateButton.className = "simulate-selector-button";
      simulateButton.role = "button";
      simulateButton.textContent = "Simulate Notify Me";
      
      simulateButton.addEventListener("click", (event) => {
        stopEvent(event);
        const selectorInput = document.querySelector('.selector-input');
        if (selectorInput) {
          selectorInput.value = textToCopy;
          // Try to find the element
          if (!document.querySelector(textToCopy)) {
            selectorInput.style.borderColor = 'red';
          } else {
            selectorInput.style.borderColor = '';
          }
        }
      });

      buttonGroup.appendChild(simulateButton);

      const simulatePreorderButton = document.createElement("div");
      simulatePreorderButton.className = "simulate-selector-button";
      simulatePreorderButton.role = "button";
      simulatePreorderButton.textContent = "Simulate Preorder";
      
      simulatePreorderButton.addEventListener("click", (event) => {
        stopEvent(event);
        const buttonSelector = document.querySelector('.button-selector');
        const textSelector = document.querySelector('.text-selector');
        if (buttonSelector && textSelector) {
          buttonSelector.value = textToCopy;
          textSelector.value = 'span';
          // Try to find the element
          if (!document.querySelector(textToCopy)) {
            buttonSelector.style.borderColor = 'red';
          } else {
            buttonSelector.style.borderColor = '';
          }
        }
      });

      buttonGroup.appendChild(simulatePreorderButton);

    }
    
    return buttonGroup;
  }

  function getSelector(element) {
    let selector = element.tagName.toLowerCase();
    
    if (element.id && 
        typeof element.id === 'string' && 
        !String(element.id).match(/\d/) &&
        !element.id.includes('[object ')) {
      selector += `#${element.id}`;
    }
    
    const validClasses = Array.from(element.classList)
      .filter(cls => 
        !cls.match(/.*\d+.*/) && 
        cls !== 'highlighted-button' &&
        cls !== 'button' &&
        !['btn', 'button', 'button--full-width'].includes(cls.toLowerCase())
      )
      .slice(0, 2);

    if (validClasses.length > 0) {
      selector += `.${validClasses.join('.')}`;
    }
    
    return selector;
  }

  function getParentButtonSelector(button, parent) {
    let selector = getSelector(button);
    let currentElement = button.parentElement;
    let parentSelectors = [];
    
    // Build array of parent selectors up to the current parent
    while (currentElement && currentElement !== parent.parentElement) {
      parentSelectors.unshift(getSelector(currentElement));
      currentElement = currentElement.parentElement;
    }
    
    // Join all selectors with '>'
    return parentSelectors.join(' > ') + ' > ' + selector;
  }

  function stopEvent(event) {
    event.stopPropagation();
    event.preventDefault();
  }

  function shouldIgnoreElement(element) {
    return ignoreSelectors.some(selector => {
      if (element.matches(selector)) return true;
      
      let parent = element.parentElement;
      for (let i = 0; i < 3 && parent; i++) {
        if (parent.matches(selector)) return true;
        parent = parent.parentElement;
      }
      return false;
    });
  }

  function positionContainer(button, container) {
    // Always position in top right corner
    container.style.position = 'fixed';
    container.style.right = '20px';
    container.style.top = '20px';
  }

  // Start the application
  chrome.storage.sync.get(['enabled', 'autoDetect'], (settings) => {
    if (settings.enabled && settings.autoDetect) {
      init();
    }
  });
})();
