document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.expand();

    const loader = document.getElementById('loader');
    const appContainer = document.getElementById('app-container');
    const referenceImage = document.getElementById('reference-image');
    const canvas = document.getElementById('mask-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const brushSizeSlider = document.getElementById('brush-size-slider');
    const brushSizeValue = document.getElementById('brush-size-value');
    const confirmButton = document.getElementById('confirm-button');
    const customCursor = document.getElementById('custom-cursor');
    const drawingArea = document.getElementById('drawing-area'); // Parent area
    const panzoomWrapper = document.getElementById('panzoom-wrapper'); // Panzoom target wrapper
    const imageCanvasContainer = document.getElementById('image-canvas-container'); // Content to pan/zoom
    const errorMessage = document.getElementById('error-message');

    let isDrawing = false;
    let lastX = 0; // Canvas coordinates
    let lastY = 0; // Canvas coordinates
    let brushSize = parseInt(brushSizeSlider.value, 10);
    let history = [];
    let originalImageWidth = 0;
    let originalImageHeight = 0;
    let imageId = null;
    let panzoomInstance = null; // To store the Panzoom instance

    function init() {
        showLoader(true);
        errorMessage.textContent = '';

        const urlParams = new URLSearchParams(window.location.hash.substring(1));
        const imageUrl = urlParams.get('imageUrl');
        imageId = urlParams.get('imageId');

        if (!imageUrl) {
            showError("Error: Image URL not provided.");
            showLoader(false);
            return;
        }

        referenceImage.onload = () => {
            console.log('Reference image loaded');
            originalImageWidth = referenceImage.naturalWidth;
            originalImageHeight = referenceImage.naturalHeight;

            // Set container size (important for Panzoom)
            imageCanvasContainer.style.width = `${originalImageWidth}px`;
            imageCanvasContainer.style.height = `${originalImageHeight}px`;
            canvas.width = originalImageWidth;
            canvas.height = originalImageHeight;

            clearCanvas();
            saveHistory(); // Save initial transparent state

            // Initialize Panzoom *after* image is loaded and dimensions are set
            setupPanzoom();

            showLoader(false);
            tg.ready();
            console.log(`Canvas initialized: ${canvas.width}x${canvas.height}`);
        };

        referenceImage.onerror = () => {
            showError("Error: Failed to load reference image.");
            showLoader(false);
        };

        console.log(`Loading image from: ${imageUrl}`);
        referenceImage.src = imageUrl;

        setupEventListeners();
        updateBrushSizeDisplay(); // Initial display
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
            panzoomInstance.destroy(); // Destroy previous instance if any
        }
        panzoomInstance = Panzoom(imageCanvasContainer, {
            maxScale: 5, // Limit max zoom
            minScale: 0.5, // Limit min zoom (allow zooming out slightly)
            contain: 'outside', // Keep the content within the panzoomWrapper bounds
            canvas: true, // Optimize for canvas/image content
            // We need to prevent Panzoom from capturing events when we intend to draw
            filterKey: () => true, // Default Panzoom key filtering (allow keys)
            // Exclude clicks/drags starting *directly* on the canvas when drawing
            // Panzoom listens on the *container* (imageCanvasContainer)
             // We'll manage enabling/disabling via event listeners instead
            handleStartEvent: (e) => {
                 // Don't start panning if the event target is the canvas and we are drawing
                 if (e.target === canvas || isDrawing) {
                     // e.preventDefault(); // Let canvas handle it - don't prevent default here
                     return;
                 }
                 e.preventDefault(); // Prevent default browser actions ONLY when panning
                 // e.stopPropagation(); // Prevent bubbling? Maybe not needed.
            }
        });

        // Add wheel listener to the wrapper for zooming
        panzoomWrapper.addEventListener('wheel', (event) => {
            if (!event.ctrlKey) { // Allow default page scroll with Ctrl
                 panzoomInstance.zoomWithWheel(event);
            }
        });

         // Reset pan/zoom on double click (optional)
        // panzoomWrapper.addEventListener('dblclick', (event) => {
        //      if(event.target !== canvas) { // Don't reset if double clicking on canvas
        //         panzoomInstance.reset();
        //      }
        // });

         console.log("Panzoom initialized");
    }


    // --- Canvas and Drawing Logic ---
    function clearCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        console.log('Canvas cleared (transparent)');
    }

    function draw(e) {
        if (!isDrawing || !panzoomInstance) return;

        // Get coordinates correctly mapped to the canvas, considering pan/zoom
        const { x, y } = getCanvasCoordinates(e);

        // Check if coordinates are valid (within canvas bounds)
        if (isNaN(x) || isNaN(y)) return; // Avoid drawing if coords are invalid

        ctx.strokeStyle = 'white';
        ctx.lineWidth = brushSize; // Draw with the logical brush size
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
        // Prevent Panzoom from interfering
        panzoomInstance?.setStyle('touch-action', 'none'); // Disable panzoom touch actions
        panzoomWrapper.classList.add('is-drawing'); // Change cursor via CSS

        isDrawing = true;
        saveHistory(); // Save state before drawing starts
        const { x, y } = getCanvasCoordinates(e);

         // Check if coordinates are valid before setting lastX/Y
        if (isNaN(x) || isNaN(y)) {
            console.warn("Invalid start coordinates, aborting draw start");
            isDrawing = false; // Prevent drawing continuation
            stopDrawing(); // Reset panzoom style etc.
            return;
        }

        [lastX, lastY] = [x, y];
        draw(e); // Draw initial dot/start
    }

    function stopDrawing() {
         // Re-enable Panzoom
        panzoomInstance?.setStyle('touch-action', 'auto'); // Restore panzoom touch actions
        panzoomWrapper.classList.remove('is-drawing'); // Restore cursor via CSS

        if (isDrawing) {
            isDrawing = false;
        }
    }

    // --- Coordinate Calculation with Panzoom ---
    function getCanvasCoordinates(e) {
        if (!panzoomInstance) return { x: NaN, y: NaN };

        const rect = canvas.getBoundingClientRect(); // Get current screen position/size of canvas
        const panzoomRect = panzoomWrapper.getBoundingClientRect(); // Get screen position of the container

        let clientX, clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        // 1. Coordinates relative to the panzoom *wrapper*
        const relativeX = clientX - panzoomRect.left;
        const relativeY = clientY - panzoomRect.top;

        // 2. Get current Panzoom scale and translation
        const currentScale = panzoomInstance.getScale();
        const currentPan = panzoomInstance.getPan(); // { x, y } - translation values

        // 3. Calculate coordinates relative to the *unscaled, untranslated* content
        // Inverse transform: (screen coords - pan) / scale
        const contentX = (relativeX - currentPan.x) / currentScale;
        const contentY = (relativeY - currentPan.y) / currentScale;

        // Check bounds (optional but good)
        if (contentX < 0 || contentX > canvas.width || contentY < 0 || contentY > canvas.height) {
           // console.log("Draw attempt outside canvas bounds");
        }

        // Coordinates should now be correct relative to the top-left of the canvas element
        return { x: contentX, y: contentY };
    }


    // --- History (Undo) Logic ---
    function saveHistory() {
        if (history.length > 20) history.shift();
        try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            history.push(imageData);
            console.log(`History saved. Length: ${history.length}`);
        } catch (e) {
            console.error("Error saving history:", e);
            showError("Could not save undo state.");
        }
    }

    function undoLast() {
        if (history.length > 1) {
            history.pop();
            const lastState = history[history.length - 1];
            // Clear before putting image data to avoid artifacts if sizes differ (shouldn't here)
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.putImageData(lastState, 0, 0);
            console.log(`Undo performed. History length: ${history.length}`);
        } else {
            console.log("Cannot undo further.");
        }
    }

    // --- Brush Size and Cursor Logic ---
    function updateBrushSizeDisplay() {
        brushSizeValue.textContent = `${brushSize}px`;
        // Adjust visual cursor size based on current zoom level
        const currentScale = panzoomInstance?.getScale() || 1;
        const displaySize = brushSize * currentScale;
        customCursor.style.width = `${displaySize}px`;
        customCursor.style.height = `${displaySize}px`;
    }

    function handleBrushSizeChange() {
        brushSize = parseInt(brushSizeSlider.value, 10);
        updateBrushSizeDisplay();
    }

    function updateCustomCursor(e) {
         if (!panzoomInstance) return;
         // Position cursor relative to the drawingArea (its parent)
        const rect = drawingArea.getBoundingClientRect();
        customCursor.style.left = `${e.clientX - rect.left}px`;
        customCursor.style.top = `${e.clientY - rect.top}px`;
        customCursor.style.display = 'block';

        // Update size dynamically if zoom changes while cursor is visible
        updateBrushSizeDisplay();
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        // Cursor visibility controlled by drawingArea now
        drawingArea.addEventListener('mouseenter', updateCustomCursor);
        drawingArea.addEventListener('mouseleave', () => {
             customCursor.style.display = 'none';
        });
         // Update cursor position on mouse move over the drawing area
        drawingArea.addEventListener('mousemove', updateCustomCursor);


        // Drawing listeners on canvas (Mouse)
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        // mouseleave event for canvas (needed if mouse moves fast off canvas while drawing)
        canvas.addEventListener('mouseleave', stopDrawing);


        // Drawing listeners on canvas (Touch)
        canvas.addEventListener('touchstart', (e) => {
            // Don't preventDefault here, let Panzoom handle pinch/pan if needed
             // Check if it's a single touch to start drawing
             if (e.touches.length === 1) {
                //e.preventDefault(); // Only prevent default for single touch drawing
                startDrawing(e);
             }
        }, { passive: true }); // Allow default pinch/zoom

        canvas.addEventListener('touchmove', (e) => {
            // Only prevent default if actually drawing (single touch)
            if (isDrawing && e.touches.length === 1) {
                e.preventDefault();
                draw(e);
            }
        }, { passive: false }); // Needs false to prevent scroll when drawing

        canvas.addEventListener('touchend', stopDrawing);
        canvas.addEventListener('touchcancel', stopDrawing);

        // Brush size slider
        brushSizeSlider.addEventListener('input', handleBrushSizeChange);

        // Undo listener
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                undoLast();
            }
        });

        // Confirm button listener
        confirmButton.addEventListener('click', handleConfirm);

        // Listen for Panzoom changes to update cursor size
        if (imageCanvasContainer) {
            imageCanvasContainer.addEventListener('panzoomchange', (event) => {
                // Update cursor size whenever zoom changes
                updateBrushSizeDisplay();
            });
        }

        // Update cursor size on window resize
        window.addEventListener('resize', updateBrushSizeDisplay);
    }

    // --- Confirmation and Data Sending ---
    function handleConfirm() {
        console.log('Confirm button clicked');
        errorMessage.textContent = '';
        confirmButton.disabled = true;
        confirmButton.textContent = 'Processing...';

        try {
            // Save current drawing state
            const currentState = ctx.getImageData(0, 0, canvas.width, canvas.height);
            // Set composite operation to draw *behind* existing content
            ctx.globalCompositeOperation = 'destination-over';
            // Fill with black background
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Export as JPEG
            const quality = 0.9;
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            console.log(`Generated JPEG data URL (length: ${dataUrl.length})`);

            // Restore original drawing state (transparent background)
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.putImageData(currentState, 0, 0);
            ctx.globalCompositeOperation = 'source-over'; // Reset operation

            const base64Data = dataUrl.split(',')[1];
            const dataToSend = { maskData: base64Data, imageId: imageId };

            tg.sendData(JSON.stringify(dataToSend));
            console.log('Data sent to Telegram bot.');

        } catch (error) {
            console.error("Error exporting or sending mask data:", error);
            showError("Failed to export or send the mask. Please try again.");
            confirmButton.disabled = false;
            confirmButton.textContent = 'Confirm';
            ctx.globalCompositeOperation = 'source-over'; // Reset on error
        }
    }

    init();
});