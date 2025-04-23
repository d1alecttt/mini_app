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
    const imageCanvasWrapper = document.getElementById('image-canvas-wrapper'); // Get the wrapper
    const errorMessage = document.getElementById('error-message');

    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let brushSize = parseInt(brushSizeSlider.value, 10);
    let history = [];
    let originalImageWidth = 0;
    let originalImageHeight = 0;
    let imageId = null;

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

            // Set wrapper, canvas, and image dimensions
            imageCanvasWrapper.style.width = `${originalImageWidth}px`;
            imageCanvasWrapper.style.height = `${originalImageHeight}px`;
            canvas.width = originalImageWidth;
            canvas.height = originalImageHeight;
            // Image size is handled by CSS max-width/height within wrapper now

            clearCanvas(); // Use clearRect for transparent background
            saveHistory(); // Save initial transparent state

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

    // --- Canvas and Drawing Logic ---
    function clearCanvas() {
        // Clear canvas to transparent for overlay drawing
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        console.log('Canvas cleared (transparent)');
    }

    function draw(e) {
        if (!isDrawing) return;
        const { x, y } = getCanvasCoordinates(e);

        ctx.strokeStyle = 'white'; // Draw mask in white
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = 'source-over'; // Ensure drawing is on top

        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();

        [lastX, lastY] = [x, y];
    }

    function startDrawing(e) {
        isDrawing = true;
        saveHistory(); // Save state *before* the new stroke starts
        const { x, y } = getCanvasCoordinates(e);
        [lastX, lastY] = [x, y];
        // Trigger a draw event immediately for small dots on click/tap
        draw(e);
    }

    function stopDrawing() {
        if (isDrawing) {
            isDrawing = false;
        }
    }

     function getCanvasCoordinates(e) {
        const rect = canvas.getBoundingClientRect(); // Use canvas rect for coordinate mapping
        let clientX, clientY;

        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        // Map client coordinates to canvas coordinates
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (clientX - rect.left) * scaleX;
        const canvasY = (clientY - rect.top) * scaleY;

        return { x: canvasX, y: canvasY };
    }

    // --- History (Undo) Logic ---
    function saveHistory() {
        if (history.length > 20) {
            history.shift();
        }
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
            ctx.putImageData(lastState, 0, 0);
            console.log(`Undo performed. History length: ${history.length}`);
        } else {
            console.log("Cannot undo further.");
        }
    }

    // --- Brush Size and Cursor Logic ---
    function updateBrushSizeDisplay() {
        brushSizeValue.textContent = `${brushSize}px`;
        // Adjust cursor size based on canvas scaling relative to wrapper if needed
        const rect = canvas.getBoundingClientRect();
        const scale = rect.width / canvas.width; // Assuming uniform scaling
        const displayBrushSize = brushSize * scale;
        customCursor.style.width = `${displayBrushSize}px`;
        customCursor.style.height = `${displayBrushSize}px`;
    }

    function handleBrushSizeChange() {
        brushSize = parseInt(brushSizeSlider.value, 10);
        updateBrushSizeDisplay();
    }

    function updateCustomCursor(e) {
        // Position cursor relative to the wrapper
        const rect = imageCanvasWrapper.getBoundingClientRect();
        customCursor.style.left = `${e.clientX - rect.left}px`;
        customCursor.style.top = `${e.clientY - rect.top}px`;
        customCursor.style.display = 'block';
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        // Use wrapper for mouse enter/leave to control cursor visibility
        imageCanvasWrapper.addEventListener('mouseenter', (e) => {
            updateCustomCursor(e);
            updateBrushSizeDisplay(); // Recalc cursor size on enter
        });
        imageCanvasWrapper.addEventListener('mouseleave', () => {
            customCursor.style.display = 'none';
            stopDrawing(); // Ensure drawing stops if mouse leaves while down
        });
        imageCanvasWrapper.addEventListener('mousemove', updateCustomCursor);


        // Drawing listeners on canvas (Mouse)
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        // mouseleave is handled by the wrapper now

         // Drawing listeners on canvas (Touch)
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startDrawing(e);
        }, { passive: false });
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            draw(e);
        }, { passive: false });
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

        // Update cursor size if window resizes (affects scaling)
        window.addEventListener('resize', updateBrushSizeDisplay);
    }

    // --- Confirmation and Data Sending ---
    function handleConfirm() {
        console.log('Confirm button clicked');
        errorMessage.textContent = '';
        confirmButton.disabled = true;
        confirmButton.textContent = 'Processing...';

        try {
            // --- IMPORTANT: Add black background before exporting ---
            // Save current state (drawing)
            const currentState = ctx.getImageData(0, 0, canvas.width, canvas.height);
            // Set operation to draw behind existing content
            ctx.globalCompositeOperation = 'destination-over';
            // Draw black background
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // --- End background addition ---

            // Export canvas as JPEG base64 string
            const quality = 0.9;
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            console.log(`Generated JPEG data URL (length: ${dataUrl.length})`);

            // --- Restore canvas state (remove black background) ---
            ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear everything
            ctx.putImageData(currentState, 0, 0); // Put the drawing back
            ctx.globalCompositeOperation = 'source-over'; // Reset composite operation
            // --- End restoring state ---

            const base64Data = dataUrl.split(',')[1];
            const dataToSend = { maskData: base64Data, imageId: imageId };

            tg.sendData(JSON.stringify(dataToSend));
            console.log('Data sent to Telegram bot.');
            // tg.close(); // Called automatically after sendData

        } catch (error) {
            console.error("Error exporting or sending mask data:", error);
            showError("Failed to export or send the mask. Please try again.");
            confirmButton.disabled = false;
            confirmButton.textContent = 'Confirm';
            // Restore composite operation in case of error during export
            ctx.globalCompositeOperation = 'source-over';
        }
    }

    init();
});