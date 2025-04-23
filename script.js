document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.expand(); // Expand the Mini App to full height

    const loader = document.getElementById('loader');
    const appContainer = document.getElementById('app-container');
    const referenceImage = document.getElementById('reference-image');
    const canvas = document.getElementById('mask-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); // willReadFrequently for getImageData performance
    const brushSizeSlider = document.getElementById('brush-size-slider');
    const brushSizeValue = document.getElementById('brush-size-value');
    const confirmButton = document.getElementById('confirm-button');
    const customCursor = document.getElementById('custom-cursor');
    const canvasContainer = document.getElementById('canvas-container');
    const errorMessage = document.getElementById('error-message');

    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let brushSize = parseInt(brushSizeSlider.value, 10);
    let history = []; // For undo functionality
    let originalImageWidth = 0;
    let originalImageHeight = 0;
    let imageId = null; // To store the identifier passed from the bot

    // --- Initialization ---
    function init() {
        showLoader(true);
        errorMessage.textContent = ''; // Clear previous errors

        // 1. Get image URL/ID from URL parameters passed by the bot
        const urlParams = new URLSearchParams(window.location.hash.substring(1)); // Use hash for parameters
        const imageUrl = urlParams.get('imageUrl');
        imageId = urlParams.get('imageId'); // Store the image identifier

        if (!imageUrl) {
            showError("Error: Image URL not provided in parameters.");
            showLoader(false);
            return;
        }
        if (!imageId) {
            console.warn("Warning: Image ID not provided in parameters. Will not be sent back.");
        }

        // 2. Load the reference image
        referenceImage.onload = () => {
            console.log('Reference image loaded');
            originalImageWidth = referenceImage.naturalWidth;
            originalImageHeight = referenceImage.naturalHeight;

            // 3. Setup canvas dimensions
            canvas.width = originalImageWidth;
            canvas.height = originalImageHeight;

            // 4. Initialize canvas (black background) and history
            clearCanvas();
            saveHistory(); // Save initial black state

            showLoader(false); // Hide loader, show app
            tg.ready(); // Inform Telegram the app is ready
            console.log(`Canvas initialized: ${canvas.width}x${canvas.height}`);
        };

        referenceImage.onerror = () => {
            showError("Error: Failed to load the reference image. Please try again.");
            showLoader(false);
        };

        console.log(`Loading image from: ${imageUrl}`);
        referenceImage.src = imageUrl; // Start loading

        // 5. Setup Event Listeners
        setupEventListeners();

        // 6. Set initial brush size display
        updateBrushSizeDisplay();

        // 7. Configure Telegram Main Button (optional, alternative to HTML button)
        // tg.MainButton.setText('Confirm Mask');
        // tg.MainButton.textColor = '#FFFFFF';
        // tg.MainButton.color = '#3390EC'; // Match your CSS button color
        // tg.MainButton.show();
        // tg.onEvent('mainButtonClicked', handleConfirm);
    }

    // --- UI Helpers ---
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
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        console.log('Canvas cleared to black');
    }

    function draw(e) {
        if (!isDrawing) return;

        const { x, y } = getCanvasCoordinates(e);

        ctx.strokeStyle = 'white';
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round'; // Smooth line ends
        ctx.lineJoin = 'round'; // Smooth line connections

        ctx.beginPath();
        // Move to the last position
        ctx.moveTo(lastX, lastY);
        // Draw a line to the current position
        ctx.lineTo(x, y);
        ctx.stroke();

        // Update last position
        [lastX, lastY] = [x, y];
    }

    function startDrawing(e) {
        isDrawing = true;
        const { x, y } = getCanvasCoordinates(e);
        [lastX, lastY] = [x, y];
        // Optional: Draw a starting dot for small brushes
        // ctx.fillStyle = 'white';
        // ctx.beginPath();
        // ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        // ctx.fill();
        saveHistory(); // Save state *before* the new stroke starts
    }

    function stopDrawing() {
        if (isDrawing) {
            isDrawing = false;
            // Save state *after* the stroke is finished?
            // saveHistory(); // Decided against this - undo should remove the whole last stroke
        }
    }

    function getCanvasCoordinates(e) {
        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;

        if (e.touches && e.touches.length > 0) {
            // Handle touch events
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            // Handle mouse events
            clientX = e.clientX;
            clientY = e.clientY;
        }

        // Calculate coordinates relative to the canvas, considering scaling/scrolling
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (clientX - rect.left) * scaleX;
        const canvasY = (clientY - rect.top) * scaleY;

        return { x: canvasX, y: canvasY };
    }


    // --- History (Undo) Logic ---
    function saveHistory() {
        // Limit history size to prevent memory issues (e.g., keep last 20 states)
        if (history.length > 20) {
            history.shift(); // Remove the oldest state
        }
        // Store the current canvas state as an ImageData object
        try {
             const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
             history.push(imageData);
             console.log(`History saved. Length: ${history.length}`);
        } catch (e) {
            console.error("Error saving history (maybe canvas is tainted?):", e);
            showError("Could not save undo state.");
        }

    }

    function undoLast() {
        if (history.length > 1) { // Keep the initial black state
            history.pop(); // Remove the current state
            const lastState = history[history.length - 1]; // Get the previous state
            ctx.putImageData(lastState, 0, 0); // Restore it
            console.log(`Undo performed. History length: ${history.length}`);
        } else {
            console.log("Cannot undo further.");
        }
    }

    // --- Brush Size and Cursor Logic ---
    function updateBrushSizeDisplay() {
        brushSizeValue.textContent = `${brushSize}px`;
        customCursor.style.width = `${brushSize}px`;
        customCursor.style.height = `${brushSize}px`;
    }

    function handleBrushSizeChange() {
        brushSize = parseInt(brushSizeSlider.value, 10);
        updateBrushSizeDisplay();
    }

    function updateCustomCursor(e) {
        // Position the custom cursor div relative to the canvas container
        const rect = canvasContainer.getBoundingClientRect(); // Use container's rect
        customCursor.style.left = `${e.clientX - rect.left}px`;
        customCursor.style.top = `${e.clientY - rect.top}px`;
        customCursor.style.display = 'block';
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        // Drawing listeners (Mouse)
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseleave', () => {
             stopDrawing();
             customCursor.style.display = 'none'; // Hide cursor when mouse leaves canvas
        });
        canvas.addEventListener('mouseenter', (e) => { // Show cursor on enter
             updateCustomCursor(e);
        });

         // Drawing listeners (Touch)
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Prevent scrolling while drawing
            startDrawing(e);
        }, { passive: false });
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault(); // Prevent scrolling while drawing
            draw(e);
        }, { passive: false });
        canvas.addEventListener('touchend', stopDrawing);
        canvas.addEventListener('touchcancel', stopDrawing);


        // Custom cursor listener (relative to container for positioning)
        canvasContainer.addEventListener('mousemove', updateCustomCursor);
        canvasContainer.addEventListener('mouseleave', () => { // Hide when leaving container
             customCursor.style.display = 'none';
        });

        // Brush size slider
        brushSizeSlider.addEventListener('input', handleBrushSizeChange);

        // Undo listener
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key.toLowerCase() === 'z') {
                e.preventDefault(); // Prevent browser's default undo
                undoLast();
            }
        });

        // Confirm button listener
        confirmButton.addEventListener('click', handleConfirm);
    }

    // --- Confirmation and Data Sending ---
    function handleConfirm() {
        console.log('Confirm button clicked');
        errorMessage.textContent = ''; // Clear errors
        confirmButton.disabled = true; // Prevent double clicks
        confirmButton.textContent = 'Processing...';

        try {
            // Export canvas as JPEG base64 string
            // Quality ranges from 0 to 1. 0.9 is usually a good balance.
            const quality = 0.9;
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            console.log(`Generated JPEG data URL (length: ${dataUrl.length})`);

            // Remove the "data:image/jpeg;base64," prefix
            const base64Data = dataUrl.split(',')[1];

            // Prepare data object to send back
            const dataToSend = {
                maskData: base64Data,
                imageId: imageId // Include the identifier for the original image
            };

            // Send data back to the bot
            tg.sendData(JSON.stringify(dataToSend));
            console.log('Data sent to Telegram bot:', dataToSend);

            // Note: tg.close() will be called automatically after sendData
            // tg.close(); // You typically don't need to call this manually

        } catch (error) {
            console.error("Error exporting or sending mask data:", error);
            showError("Failed to export or send the mask. Please try again.");
            confirmButton.disabled = false;
            confirmButton.textContent = 'Confirm';
        }
    }

    // --- Start the application ---
    init();
});