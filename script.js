document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.expand();

    // DOM Elements
    const loader = document.getElementById('loader');
    const appContainer = document.getElementById('app-container');
    const referenceImage = document.getElementById('reference-image');
    const canvas = document.getElementById('mask-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
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
    let lastX = 0; // Canvas coordinates
    let lastY = 0; // Canvas coordinates
    let brushSize = parseInt(brushSizeSlider.value, 10);
    let history = [];
    let originalImageWidth = 0;
    let originalImageHeight = 0;
    let imageId = null;
    let panzoomInstance = null;
    let currentTool = 'draw'; // 'draw' or 'pan'

    // --- Initialization ---
    function init() {
        showLoader(true); errorMessage.textContent = '';
        const urlParams = new URLSearchParams(window.location.hash.substring(1));
        const imageUrl = urlParams.get('imageUrl'); imageId = urlParams.get('imageId');
        if (!imageUrl) { showError("Error: Image URL not provided."); showLoader(false); return; }

        referenceImage.onload = () => {
            originalImageWidth = referenceImage.naturalWidth; originalImageHeight = referenceImage.naturalHeight;
            imageCanvasContainer.style.width = `${originalImageWidth}px`; imageCanvasContainer.style.height = `${originalImageHeight}px`;
            canvas.width = originalImageWidth; canvas.height = originalImageHeight;
            clearCanvas(); saveHistory();
            setupPanzoom(); // Init Panzoom *after* dimensions are set
            showLoader(false); tg.ready(); console.log(`Canvas initialized: ${canvas.width}x${canvas.height}`);
            updateToolUI(); // Set initial tool state
        };
        referenceImage.onerror = () => { showError("Error: Failed to load reference image."); showLoader(false); };
        referenceImage.src = imageUrl;
        setupEventListeners(); updateBrushSizeDisplay();
    }
    function showLoader(show) { loader.style.display = show ? 'block' : 'none'; appContainer.style.display = show ? 'none' : 'flex'; }
    function showError(message) { errorMessage.textContent = message; console.error(message); }

    // --- Panzoom Setup ---
    function setupPanzoom() {
        if (panzoomInstance) panzoomInstance.destroy();
        panzoomInstance = Panzoom(imageCanvasContainer, { // Target the container
            maxScale: 10, minScale: 0.3, contain: 'outside', canvas: true,
            // Disable pan/zoom initially (draw tool is default)
            disablePan: true, disableZoom: true,
            // Start event handling - mainly for debugging or complex filters if needed
             handleStartEvent: e => {
                 // Allow Panzoom to handle touch pinch/multi-touch regardless of tool
                 if (e.touches && e.touches.length > 1) {
                     return; // Don't prevent default for pinch zoom
                 }
                 // If draw tool is active, don't let Panzoom handle single touch/mouse on the canvas
                 if (currentTool === 'draw' && e.target === canvas) {
                     return;
                 }
                 // If pan tool is active, prevent default browser actions (like image drag)
                 // This allows Panzoom's panning to work smoothly.
                 if (currentTool === 'pan') {
                     e.preventDefault();
                     // e.stopPropagation(); // Usually not needed here
                 }
             },
             // Panzoom listens on the container, so clicks on canvas need separate check
            // Panzoom 4+ doesn't have an easy "no drag button 1" option, we manage via disablePan/Zoom
        });
        // Wheel zoom listener ON THE WRAPPER (viewport)
        panzoomWrapper.addEventListener('wheel', handleWheelZoom, { passive: false }); // Needs false to prevent page scroll potentially
        // Listen for panzoom changes (scale) to update cursor size
        imageCanvasContainer.addEventListener('panzoomchange', handlePanzoomChange);
        console.log("Panzoom initialized");
    }

    function handleWheelZoom(event) {
        // Zoom ONLY if pan tool is active
        if (currentTool === 'pan' && panzoomInstance) {
            // Prevent default page scroll when zooming inside the wrapper
            event.preventDefault();
            panzoomInstance.zoomWithWheel(event);
        }
        // If draw tool is active, allow default page scroll
    }

    function handlePanzoomChange(event) { updateBrushSizeDisplay(); }

    // --- Tool Switching ---
    function setTool(tool) {
        if (tool === currentTool || (tool !== 'draw' && tool !== 'pan')) return;
        currentTool = tool;
        console.log("Tool changed to:", currentTool);
        updateToolUI();
    }

    function updateToolUI() {
        const isDraw = currentTool === 'draw';
        toolDrawButton.classList.toggle('active', isDraw);
        toolPanButton.classList.toggle('active', !isDraw);
        drawingArea.classList.toggle('tool-draw', isDraw);
        drawingArea.classList.toggle('tool-pan', !isDraw);
        panzoomWrapper.classList.toggle('tool-draw', isDraw);
        panzoomWrapper.classList.toggle('tool-pan', !isDraw);

        // --- Enable/Disable Panzoom ---
        if (panzoomInstance) {
            panzoomInstance.setOptions({
                disablePan: isDraw, // Disable panning when drawing
                disableZoom: isDraw // Disable zooming when drawing
            });
             // Ensure touch-action is appropriate
             // 'auto' allows Panzoom to control panning/zooming when enabled
             // 'pinch-zoom pan-x pan-y' allows browser defaults when Panzoom is disabled
             panzoomInstance.setStyle('touch-action', isDraw ? 'pinch-zoom pan-y pan-x' : 'none');
        }

        // Update cursor visibility based on tool
        updateCustomCursor(); // Call without event to just update visibility
    }


    // --- Canvas and Drawing Logic ---
    function clearCanvas() { ctx.clearRect(0, 0, canvas.width, canvas.height); }

    function draw(e) {
        if (currentTool !== 'draw' || !isDrawing || !panzoomInstance) return;
        const { x, y } = getCanvasCoordinates(e); // Use the corrected function
        if (isNaN(x) || isNaN(y)) return;
        ctx.strokeStyle = 'white'; ctx.lineWidth = brushSize; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(x, y); ctx.stroke();
        [lastX, lastY] = [x, y];
    }

    function startDrawing(e) {
        if (currentTool !== 'draw') return;
        isDrawing = true;
        saveHistory(); // Save state before starting stroke
        const { x, y } = getCanvasCoordinates(e);
        if (isNaN(x) || isNaN(y)) { isDrawing = false; return; }
        [lastX, lastY] = [x, y];
        // Draw a dot for the start, especially for taps
        ctx.fillStyle = 'white';
        ctx.beginPath(); ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2); ctx.fill();
        // We still call draw in case it's a drag start
        // draw(e); // Might not be needed if arc is drawn
    }

    function stopDrawing() { if (isDrawing) { isDrawing = false; } }

    // --- Corrected Coordinate Calculation ---
    function getCanvasCoordinates(e) {
        if (!panzoomInstance) return { x: NaN, y: NaN };

        // 1. Get event coordinates relative to the viewport
        let clientX, clientY;
        if (e.touches && e.touches.length > 0) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
        else { clientX = e.clientX; clientY = e.clientY; }

        // 2. Get the bounding box of the panzoom viewport (the scrollable/pannable area)
        const wrapperRect = panzoomWrapper.getBoundingClientRect();

        // 3. Calculate pointer position relative to the viewport's top-left corner
        const pointerX = clientX - wrapperRect.left;
        const pointerY = clientY - wrapperRect.top;

        // 4. Get current Panzoom scale and pan offset
        const scale = panzoomInstance.getScale();
        const pan = panzoomInstance.getPan(); // { x: currentPanX, y: currentPanY }

        // 5. Apply the inverse transformation to get coordinates relative to the *unscaled, untranslated* content (the canvas)
        // Formula: canvasCoord = (pointerCoord - panOffset) / scale
        const canvasX = (pointerX - pan.x) / scale;
        const canvasY = (pointerY - pan.y) / scale;

        // console.log(`Client: ${clientX.toFixed(1)},${clientY.toFixed(1)} | Wrapper: ${wrapperRect.left.toFixed(1)},${wrapperRect.top.toFixed(1)} | Relative: ${pointerX.toFixed(1)},${pointerY.toFixed(1)} | Pan: ${pan.x.toFixed(1)},${pan.y.toFixed(1)} | Scale: ${scale.toFixed(2)} | Canvas: ${canvasX.toFixed(1)},${canvasY.toFixed(1)}`);

        return { x: canvasX, y: canvasY };
    }


    // --- History (Undo) Logic ---
    function saveHistory() {
        if (history.length > 20) history.shift();
        try { history.push(ctx.getImageData(0, 0, canvas.width, canvas.height)); }
        catch (e) { console.error("History save error:", e); showError("Undo state error."); }
    }
    function undoLast() { if (history.length > 1) { history.pop(); ctx.putImageData(history[history.length - 1], 0, 0); } else { console.log("Cannot undo."); } }

    // --- Brush Size and Cursor Logic ---
    function updateBrushSizeDisplay() {
        brushSizeValue.textContent = `${brushSize}px`;
        const currentScale = panzoomInstance?.getScale() || 1;
        const displaySize = Math.max(2, brushSize * currentScale); // Visual size based on zoom
        customCursor.style.width = `${displaySize}px`; customCursor.style.height = `${displaySize}px`;
    }
    function handleBrushSizeChange() { brushSize = parseInt(brushSizeSlider.value, 10); updateBrushSizeDisplay(); }

    function updateCustomCursor(e) { // Optional event arg
        if (currentTool !== 'draw') { customCursor.style.display = 'none'; return; }
        // If event is provided, update position
        if(e) {
             const rect = drawingArea.getBoundingClientRect();
             customCursor.style.left = `${e.clientX - rect.left}px`;
             customCursor.style.top = `${e.clientY - rect.top}px`;
        }
        customCursor.style.display = 'block'; // Ensure visible if draw tool is active
        updateBrushSizeDisplay(); // Ensure size is correct
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        // Tool buttons
        toolDrawButton.addEventListener('click', () => setTool('draw'));
        toolPanButton.addEventListener('click', () => setTool('pan'));

        // Cursor visibility controlled by drawingArea
        drawingArea.addEventListener('mouseenter', updateCustomCursor);
        drawingArea.addEventListener('mouseleave', () => { customCursor.style.display = 'none'; });
        drawingArea.addEventListener('mousemove', updateCustomCursor);

        // --- Drawing Listeners (on Canvas) ---
        // These events will be effectively ignored by the draw() function if currentTool !== 'draw'
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw); // draw() checks tool internally
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseleave', stopDrawing);

        // Touch listeners - use passive: true where possible to improve scroll performance
        canvas.addEventListener('touchstart', (e) => { if (currentTool === 'draw' && e.touches.length === 1) startDrawing(e); }, { passive: true });
        canvas.addEventListener('touchmove', (e) => { if (currentTool === 'draw' && isDrawing && e.touches.length === 1) { e.preventDefault(); draw(e); } }, { passive: false }); // preventDefault NEEDED here to stop scroll while drawing
        canvas.addEventListener('touchend', stopDrawing);
        canvas.addEventListener('touchcancel', stopDrawing);

        // Controls
        brushSizeSlider.addEventListener('input', handleBrushSizeChange);
        document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undoLast(); } });
        confirmButton.addEventListener('click', handleConfirm);
        window.addEventListener('resize', () => { panzoomInstance?.resize(); updateBrushSizeDisplay(); });
    }

    // --- Confirmation and Data Sending ---
    function handleConfirm() {
        console.log('Confirm button clicked'); errorMessage.textContent = ''; confirmButton.disabled = true; confirmButton.textContent = 'Обработка...'; // Changed text
        try {
            const currentState = ctx.getImageData(0, 0, canvas.width, canvas.height);
            ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = 'black'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            const quality = 0.9; const dataUrl = canvas.toDataURL('image/jpeg', quality);
            // Restore canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.putImageData(currentState, 0, 0); ctx.globalCompositeOperation = 'source-over';
            const base64Data = dataUrl.split(',')[1]; const dataToSend = { maskData: base64Data, imageId: imageId };
            tg.sendData(JSON.stringify(dataToSend)); console.log('Data sent to Telegram bot.');
        } catch (error) {
            console.error("Error exporting/sending mask:", error); showError("Не удалось экспортировать/отправить маску. Попробуйте снова."); // Changed text
            confirmButton.disabled = false; confirmButton.textContent = 'Подтвердить'; // Changed text
            ctx.globalCompositeOperation = 'source-over';
        }
    }

    init(); // Start
});