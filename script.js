document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.expand(); // Expand the Web App to full height

    // DOM Elements
    const loader = document.getElementById('loader');
    const appContainer = document.getElementById('app-container');
    const referenceImage = document.getElementById('reference-image');
    const canvas = document.getElementById('mask-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); // willReadFrequently for history/getImageData
    const brushSizeSlider = document.getElementById('brush-size-slider');
    const brushSizeValue = document.getElementById('brush-size-value');
    const confirmButton = document.getElementById('confirm-button');
    const customCursor = document.getElementById('custom-cursor');
    const drawingArea = document.getElementById('drawing-area');
    const panzoomWrapper = document.getElementById('panzoom-wrapper');
    const imageCanvasContainer = document.getElementById('image-canvas-container');
    const errorMessage = document.getElementById('error-message');
    const toolDrawButton = document.getElementById('tool-draw');
    const toolPanButton = document.getElementById('tool-pan');

    // State Variables
    let isDrawing = false;
    let lastX = 0; // Canvas coordinates relative to the top-left of the canvas element itself
    let lastY = 0; // Canvas coordinates relative to the top-left of the canvas element itself
    let brushSize = parseInt(brushSizeSlider.value, 10);
    let history = []; // For undo functionality
    let historyLimit = 20; // Max undo steps
    let originalImageWidth = 0;
    let originalImageHeight = 0;
    let imageId = null; // Unique ID for this editing session
    let panzoomInstance = null;
    let currentTool = 'draw'; // 'draw' or 'pan'

    // --- Initialization ---
    function init() {
        showLoader(true);
        errorMessage.textContent = '';
        const urlParams = new URLSearchParams(window.location.hash.substring(1));
        const imageUrl = urlParams.get('imageUrl');
        imageId = urlParams.get('imageId');

        if (!imageUrl || !imageId) {
            showError("Ошибка: URL изображения или ID сессии не предоставлены.");
            showLoader(false);
            tg.close();
            return;
        }

        referenceImage.onload = () => {
            originalImageWidth = referenceImage.naturalWidth;
            originalImageHeight = referenceImage.naturalHeight;
            imageCanvasContainer.style.width = `${originalImageWidth}px`;
            imageCanvasContainer.style.height = `${originalImageHeight}px`;
            canvas.width = originalImageWidth;
            canvas.height = originalImageHeight;
            clearCanvas();
            saveHistory();
            setupPanzoom();
            showLoader(false);
            tg.ready();
            console.log(`Canvas initialized: ${canvas.width}x${canvas.height}. Image ID: ${imageId}`);
            updateToolUI();
        };
        referenceImage.onerror = () => {
            showError("Ошибка: Не удалось загрузить изображение.");
            showLoader(false);
            tg.close();
        };
        referenceImage.src = imageUrl;

        setupEventListeners();
        updateBrushSizeDisplay();
    }

    function showLoader(show) {
        loader.style.display = show ? 'block' : 'none';
        appContainer.style.display = show ? 'none' : 'flex';
    }

    function showError(message) {
        errorMessage.textContent = message;
        console.error(message);
    }

    // --- Panzoom Setup ---
    function setupPanzoom() {
        if (panzoomInstance) {
            panzoomInstance.destroy();
        }
        panzoomInstance = Panzoom(imageCanvasContainer, {
            maxScale: 10,
            minScale: 0.3,
            contain: 'outside',
            canvas: true,
            disablePan: true, // Initially disabled for drawing tool
            disableZoom: true, // Initially disabled for drawing tool
            handleStartEvent: e => {
                if (e.touches && e.touches.length > 1) {
                    return; // Allow Panzoom pinch-zoom
                }
                // If draw tool is active, *ignore* event on canvas/image target, let our listeners handle it
                if (currentTool === 'draw' && (e.target === canvas || e.target === referenceImage)) {
                    // Explicitly do nothing here, preventing Panzoom from taking over
                    return;
                }
                 // If pan tool is active, prevent default browser actions (like image drag)
                 if (currentTool === 'pan') {
                    e.preventDefault();
                    // e.stopImmediatePropagation(); // Optional: if other listeners interfere
                 }
            },
        });

        panzoomWrapper.addEventListener('wheel', handleWheelZoom, { passive: false });
        imageCanvasContainer.addEventListener('panzoomchange', handlePanzoomChange);
        console.log("Panzoom initialized on #image-canvas-container");
    }

    function handleWheelZoom(event) {
        if (currentTool === 'pan' && panzoomInstance) {
            event.preventDefault();
            panzoomInstance.zoomWithWheel(event);
        }
    }

    function handlePanzoomChange(event) {
        updateBrushSizeDisplay();
    }

    // --- Tool Switching ---
    function setTool(tool) {
        if (tool === currentTool || (tool !== 'draw' && tool !== 'pan')) {
            return;
        }
        currentTool = tool;
        console.log("Tool changed to:", currentTool);
        updateToolUI();
    }

    function updateToolUI() {
        const isDraw = currentTool === 'draw';
        const isPan = currentTool === 'pan';

        toolDrawButton.classList.toggle('active', isDraw);
        toolPanButton.classList.toggle('active', isPan);
        drawingArea.classList.toggle('tool-draw', isDraw);
        drawingArea.classList.toggle('tool-pan', isPan);
        panzoomWrapper.classList.toggle('tool-draw', isDraw);
        panzoomWrapper.classList.toggle('tool-pan', isPan);

        if (panzoomInstance) {
            panzoomInstance.setOptions({
                disablePan: isDraw,
                disableZoom: isDraw // Panzoom's zoom, not browser pinch
            });
            // Controls touch interaction: 'none' lets Panzoom handle fully, 'pinch...' allows browser defaults when Panzoom is disabled
            panzoomInstance.setStyle('touch-action', isPan ? 'none' : 'pinch-zoom pan-y pan-x');
        }
        updateCustomCursor();
    }

    // --- Canvas and Drawing Logic ---
    function clearCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function draw(e) {
        // Check tool and drawing state *first*
        if (currentTool !== 'draw' || !isDrawing || !panzoomInstance) return;

        const { x, y } = getCanvasCoordinates(e);
        if (isNaN(x) || isNaN(y)) return; // Invalid coordinates

        ctx.strokeStyle = 'white';
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = 'source-over';

        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();

        [lastX, lastY] = [x, y];
    }

    function startDrawing(e) {
        // Check tool *first*
        if (currentTool !== 'draw') return;

        isDrawing = true;
        saveHistory();

        const { x, y } = getCanvasCoordinates(e);
        if (isNaN(x) || isNaN(y)) {
            isDrawing = false; // Abort if coordinates are invalid
            return;
        }
        [lastX, lastY] = [x, y];

        // Draw initial dot
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        ctx.fill();

        // console.log(`Start drawing at canvas coords: ${x.toFixed(1)}, ${y.toFixed(1)}`);
    }

    function stopDrawing() {
        if (isDrawing) {
            isDrawing = false;
            // console.log("Stop drawing");
        }
    }

    // --- Coordinate Calculation (Crucial!) ---
    function getCanvasCoordinates(e) {
        if (!panzoomInstance) return { x: NaN, y: NaN };

        let clientX, clientY;
        // Handle both touch and mouse events consistently
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX; clientY = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches.length > 0) { // Needed for touchend
             clientX = e.changedTouches[0].clientX; clientY = e.changedTouches[0].clientY;
        } else if (typeof e.clientX !== 'undefined') {
            clientX = e.clientX; clientY = e.clientY;
        } else {
             return { x: NaN, y: NaN }; // No valid coordinates found
        }

        const wrapperRect = panzoomWrapper.getBoundingClientRect();
        const pointerX = clientX - wrapperRect.left;
        const pointerY = clientY - wrapperRect.top;
        const scale = panzoomInstance.getScale();
        const pan = panzoomInstance.getPan();
        const canvasX = (pointerX - pan.x) / scale;
        const canvasY = (pointerY - pan.y) / scale;

        // Debug log (Uncomment to trace coordinates)
        // console.log(`ClientXY: ${clientX?.toFixed(1)},${clientY?.toFixed(1)} | WrapRect L,T: ${wrapperRect.left.toFixed(1)},${wrapperRect.top.toFixed(1)} | PtrXY: ${pointerX.toFixed(1)},${pointerY.toFixed(1)} | PanXY: ${pan.x.toFixed(1)},${pan.y.toFixed(1)} | Scale: ${scale.toFixed(2)} | CanvasXY: ${canvasX.toFixed(1)},${canvasY.toFixed(1)}`);

        return { x: canvasX, y: canvasY };
    }

    // --- History (Undo) Logic ---
    function saveHistory() {
        if (history.length >= historyLimit) {
            history.shift();
        }
        try {
            if (canvas.width > 0 && canvas.height > 0) {
                 history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
            } else { console.warn("Attempted history save with zero canvas dimensions."); }
        } catch (e) {
            console.error("History save error:", e); showError("Ошибка сохранения состояния для отмены.");
        }
    }
    function undoLast() {
        if (history.length > 1) {
            history.pop();
            const lastState = history[history.length - 1];
            ctx.putImageData(lastState, 0, 0);
            console.log("Undo performed. History size:", history.length);
        } else { console.log("Cannot undo further."); }
    }

    // --- Brush Size and Cursor Logic ---
    function updateBrushSizeDisplay() {
        brushSizeValue.textContent = `${brushSize}px`;
        const currentScale = panzoomInstance?.getScale() || 1;
        const displaySize = Math.max(2, brushSize * currentScale);
        customCursor.style.width = `${displaySize}px`; customCursor.style.height = `${displaySize}px`;
    }
    function handleBrushSizeChange() {
        brushSize = parseInt(brushSizeSlider.value, 10);
        updateBrushSizeDisplay();
    }
    function updateCustomCursor(e) {
        if (currentTool !== 'draw') { customCursor.style.display = 'none'; return; }
        if (e) {
             const rect = drawingArea.getBoundingClientRect();
             let clientX, clientY;
             if (e.touches) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
             else { clientX = e.clientX; clientY = e.clientY; }
             customCursor.style.left = `${clientX - rect.left}px`;
             customCursor.style.top = `${clientY - rect.top}px`;
        }
        customCursor.style.display = 'block';
        updateBrushSizeDisplay(); // Keep size updated
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        toolDrawButton.addEventListener('click', () => setTool('draw'));
        toolPanButton.addEventListener('click', () => setTool('pan'));

        drawingArea.addEventListener('mouseenter', updateCustomCursor);
        drawingArea.addEventListener('mouseleave', () => {
            customCursor.style.display = 'none';
            if (isDrawing) { // Stop drawing if mouse leaves area while drawing
                stopDrawing();
            }
        });
        drawingArea.addEventListener('mousemove', updateCustomCursor);

        // --- Drawing Listeners Directly on Canvas ---
        canvas.addEventListener('mousedown', (e) => {
            // Ensure correct tool is selected before starting
            if (currentTool === 'draw') {
                startDrawing(e);
            }
        });
        canvas.addEventListener('mousemove', (e) => {
            // draw() function already checks for currentTool and isDrawing state
            draw(e);
        });
        canvas.addEventListener('mouseup', (e) => {
            // stopDrawing() checks internal state
            stopDrawing();
        });
        // Handle mouse leaving the canvas itself (might be redundant with drawingArea check, but safe)
        canvas.addEventListener('mouseleave', (e) => {
             if (isDrawing) {
                 stopDrawing();
             }
         });

        // Touch events
        canvas.addEventListener('touchstart', (e) => {
            // Only handle single touch for drawing
            if (currentTool === 'draw' && e.touches.length === 1) {
                // Prevent default actions like scrolling *when starting a draw*
                e.preventDefault();
                startDrawing(e);
            }
            // Allow multi-touch (pinch zoom) default behavior or Panzoom handling
        }, { passive: false }); // Need passive: false to allow preventDefault

        canvas.addEventListener('touchmove', (e) => {
            // Check tool, state, and single touch *before* drawing and preventing default
            if (currentTool === 'draw' && isDrawing && e.touches.length === 1) {
                // Prevent page scroll/zoom ONLY when actively drawing with one finger
                e.preventDefault();
                draw(e);
                updateCustomCursor(e); // Update cursor during touch move
            }
        }, { passive: false }); // Need passive: false to allow preventDefault

        canvas.addEventListener('touchend', (e) => {
            // Check if a drawing touch ended
            if (isDrawing && e.changedTouches.length === 1) {
                 stopDrawing();
             }
            // Maybe hide cursor?
            // customCursor.style.display = 'none';
         }, { passive: true }); // Can be passive as we don't prevent default here

        canvas.addEventListener('touchcancel', (e) => {
             if (isDrawing) {
                 stopDrawing();
             }
             // customCursor.style.display = 'none';
         }, { passive: true });


        // --- Controls ---
        brushSizeSlider.addEventListener('input', handleBrushSizeChange);
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key?.toLowerCase() === 'z') {
                e.preventDefault(); undoLast();
            }
        });
        confirmButton.addEventListener('click', handleConfirm);
        window.addEventListener('resize', () => {
            panzoomInstance?.resize(); updateBrushSizeDisplay();
        });
    }

    // --- Confirmation and Data Sending ---
    function handleConfirm() {
        console.log('Confirm button clicked. Preparing mask data...');
        errorMessage.textContent = '';
        confirmButton.disabled = true;
        confirmButton.textContent = 'Обработка...';

        setTimeout(() => {
            try {
                const currentState = ctx.getImageData(0, 0, canvas.width, canvas.height);

                // Create final mask: White drawing on Black background
                ctx.globalCompositeOperation = 'destination-over'; // Draw behind existing content
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Export as JPEG
                const quality = 0.9;
                const dataUrl = canvas.toDataURL('image/jpeg', quality);

                // Restore canvas to state before adding background
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.putImageData(currentState, 0, 0);
                ctx.globalCompositeOperation = 'source-over'; // Reset composite mode

                const base64Data = dataUrl.split(',')[1];
                if (!base64Data) throw new Error("Failed to extract Base64 data.");

                const dataToSend = { maskData: base64Data, imageId: imageId };

                tg.sendData(JSON.stringify(dataToSend));
                console.log('Mask data prepared and sent to Telegram bot.');
                // Optionally close after sending
                // tg.close();

            } catch (error) {
                console.error("Error exporting or sending mask:", error);
                showError(`Не удалось экспортировать/отправить маску: ${error.message}`);
                confirmButton.disabled = false;
                confirmButton.textContent = 'Подтвердить';
                ctx.globalCompositeOperation = 'source-over'; // Reset on error too
            }
        }, 10);
    }

    // --- Start the application ---
    init();
});