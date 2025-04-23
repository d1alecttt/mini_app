const tg = window.Telegram.WebApp;

// --- DOM Elements ---
const loadingDiv = document.getElementById('loading');
const appContainer = document.querySelector('.app-container');
const sourceImage = document.getElementById('sourceImage');
const canvas = document.getElementById('maskCanvas');
const ctx = canvas.getContext('2d');
const brushCursor = document.getElementById('brushCursor');
const statusDiv = document.getElementById('status');

// Controls
const thicknessSlider = document.getElementById('thickness');
const thicknessValueSpan = document.getElementById('thicknessValue');
const resetBrushButton = document.getElementById('resetBrush');
const undoButton = document.getElementById('undo');

// --- State Variables ---
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let history = []; // Store drawing paths for undo
let currentPath = []; // Store points for the current stroke

// Default brush settings (add others here if implemented)
const defaultBrushSettings = {
    thickness: 15,
    // blurriness: 0,
    // hardness: 1,
    // opacity: 1,
    // smoothing: 0,
};
let brushSettings = { ...defaultBrushSettings };

let sourceImageInfo = { // To store info passed from the bot
    imageUrl: null,
    imageId: null, // Unique ID for this image session
    userId: null
};

// --- Initialization ---
function initializeApp() {
    tg.ready(); // Inform Telegram the app is ready

    // Basic Theme Adjustments (Optional)
    // You could force light/dark based on tg.colorScheme
    // document.body.style.backgroundColor = tg.themeParams.bg_color || '#ffffff';
    // document.body.style.color = tg.themeParams.text_color || '#000000';

    // Configure the Main Button (Confirm)
    tg.MainButton.setText('Confirm Mask');
    tg.MainButton.setParams({
        // Note: Specific colors set here might be overridden by theme.
        // Use CSS with !important for reliable colors if needed.
        // color: '#3498db', // Blue background
        // text_color: '#ffffff' // White text
    });
    tg.MainButton.onClick(handleConfirmMask);
    // Show main button later when image is loaded

    // --- Get launch parameters ---
    try {
        // Use initDataUnsafe for parameters passed in URL fragment
        // Example URL: https://.../index.html#imageUrl=ENCODED_URL&imageId=UUID&userId=123
        const hashParams = new URLSearchParams(tg.initDataUnsafe?.start_param ? window.location.hash.substring(1) : '');
        sourceImageInfo.imageUrl = hashParams.get('imageUrl') ? decodeURIComponent(hashParams.get('imageUrl')) : null;
        sourceImageInfo.imageId = hashParams.get('imageId') || `unknown_${Date.now()}`;
        sourceImageInfo.userId = hashParams.get('userId') || 'unknown';

        if (!sourceImageInfo.imageUrl) {
            showError("Error: Image URL not provided in launch parameters.");
            return;
        }

        // --- Load the source image ---
        sourceImage.onload = () => {
            console.log("Source image loaded:", sourceImage.naturalWidth, sourceImage.naturalHeight);
            setupCanvas();
            loadingDiv.style.display = 'none';
            appContainer.style.display = 'flex';
            tg.MainButton.show(); // Show confirm button only after load
            statusDiv.textContent = 'Draw the mask on the image.';
        };
        sourceImage.onerror = () => {
            showError("Error: Failed to load the source image from URL.");
        };
        sourceImage.src = sourceImageInfo.imageUrl;
        console.log("Attempting to load image from:", sourceImageInfo.imageUrl);

    } catch (error) {
        showError(`Initialization Error: ${error.message}`);
        console.error(error);
    }

    // --- Event Listeners ---
    setupEventListeners();
    updateBrushSettingsUI(); // Set initial slider values
}

function showError(message) {
    loadingDiv.textContent = message;
    loadingDiv.style.color = 'red';
    loadingDiv.style.display = 'block';
    appContainer.style.display = 'none';
    tg.MainButton.hide();
    console.error(message);
}


// --- Canvas Setup ---
function setupCanvas() {
    // Set canvas size to match the displayed image size
    const imgRect = sourceImage.getBoundingClientRect();

    // Important: Set canvas internal resolution to image's *natural* size
    // for 1:1 mask export.
    canvas.width = sourceImage.naturalWidth;
    canvas.height = sourceImage.naturalHeight;

    // Set canvas display size to match the *visible* image size on screen
    canvas.style.width = `${imgRect.width}px`;
    canvas.style.height = `${imgRect.height}px`;
    canvas.style.top = `${sourceImage.offsetTop}px`;
    canvas.style.left = `${sourceImage.offsetLeft}px`;

    // Initial canvas state (transparent)
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'white'; // Mask color
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = brushSettings.thickness;

    console.log(`Canvas setup: Internal=${canvas.width}x${canvas.height}, Display=${canvas.style.width}x${canvas.style.height}`);
}

// --- Drawing Logic ---
function getMousePos(canvasEl, evt) {
    const rect = canvasEl.getBoundingClientRect();
    // Scale client coordinates to canvas coordinates
    const scaleX = canvasEl.width / rect.width;
    const scaleY = canvasEl.height / rect.height;

    // Handle both mouse and touch events
    const clientX = evt.clientX ?? evt.touches[0].clientX;
    const clientY = evt.clientY ?? evt.touches[0].clientY;

    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

function startDrawing(e) {
    // Prevent default actions like scrolling on touch
    if (e.touches) e.preventDefault();

    isDrawing = true;
    const pos = getMousePos(canvas, e);
    [lastX, lastY] = [pos.x, pos.y];
    currentPath = [{ x: lastX, y: lastY }]; // Start new path segment

    // Draw a single dot if it's just a click
    ctx.beginPath();
    ctx.arc(lastX, lastY, brushSettings.thickness / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
}

function draw(e) {
    if (!isDrawing) return;
     // Prevent default actions like scrolling on touch
     if (e.touches) e.preventDefault();

    const pos = getMousePos(canvas, e);
    ctx.beginPath();
    ctx.strokeStyle = 'white'; // Ensure color is set
    ctx.lineWidth = brushSettings.thickness;
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    currentPath.push({ x: pos.x, y: pos.y }); // Add point to current segment
    [lastX, lastY] = [pos.x, pos.y];
}

function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    if (currentPath.length > 0) {
        // Save the completed path segment (with its settings) to history
        history.push({ path: [...currentPath], thickness: brushSettings.thickness });
        currentPath = []; // Reset current path
    }
    // console.log("History length:", history.length);
}

// --- Undo Logic ---
function undoLast() {
    if (history.length > 0) {
        history.pop(); // Remove the last path segment
        redrawCanvasFromHistory();
        statusDiv.textContent = `Undo successful. ${history.length} strokes remaining.`;
    } else {
         statusDiv.textContent = "Nothing to undo.";
    }
}

function redrawCanvasFromHistory() {
    // Clear the canvas completely
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Redraw each segment from history
    history.forEach(segment => {
        if (segment.path.length === 0) return;

        ctx.beginPath();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = segment.thickness; // Use thickness stored with the segment
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        ctx.moveTo(segment.path[0].x, segment.path[0].y);
        if (segment.path.length === 1) { // Handle single dot clicks stored in history
             ctx.fillStyle = 'white';
             ctx.arc(segment.path[0].x, segment.path[0].y, segment.thickness / 2, 0, Math.PI * 2);
             ctx.fill();
        } else {
            for (let i = 1; i < segment.path.length; i++) {
                ctx.lineTo(segment.path[i].x, segment.path[i].y);
            }
             ctx.stroke();
        }
    });
}

// --- Custom Brush Cursor ---
function updateBrushCursor(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Position the div, adjusting for its own size to center it
    brushCursor.style.left = `${x + canvas.offsetLeft}px`;
    brushCursor.style.top = `${y + canvas.offsetTop}px`;
    brushCursor.style.width = `${brushSettings.thickness * (rect.width / canvas.width)}px`; // Scale cursor size to display size
    brushCursor.style.height = `${brushSettings.thickness * (rect.height / canvas.height)}px`;
}

// --- Controls Update ---
function updateBrushSettingsUI() {
    thicknessSlider.value = brushSettings.thickness;
    thicknessValueSpan.textContent = brushSettings.thickness;
    brushCursor.style.width = `${brushSettings.thickness}px`; // Update cursor visual size
    brushCursor.style.height = `${brushSettings.thickness}px`;
    // Update other sliders/values if implemented
}

function resetBrushSettings() {
    brushSettings = { ...defaultBrushSettings };
    updateBrushSettingsUI();
    statusDiv.textContent = "Brush settings reset to defaults.";
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    // Drawing Listeners
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing); // Stop if cursor leaves canvas

    // Touch Listeners
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);
    canvas.addEventListener('touchcancel', stopDrawing);


    // Brush Cursor Listeners
    canvas.addEventListener('mouseenter', () => { brushCursor.style.display = 'block'; });
    canvas.addEventListener('mouseleave', () => { brushCursor.style.display = 'none'; });
    canvas.addEventListener('mousemove', updateBrushCursor); // Update cursor on move

    // Controls Listeners
    thicknessSlider.addEventListener('input', (e) => {
        brushSettings.thickness = parseInt(e.target.value, 10);
        thicknessValueSpan.textContent = brushSettings.thickness;
        // No need to update cursor size here, mousemove does it
    });

    resetBrushButton.addEventListener('click', resetBrushSettings);
    undoButton.addEventListener('click', undoLast);

    // Keyboard Listener for Undo (Ctrl+Z)
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault(); // Prevent browser's default undo
            undoLast();
        }
    });

    // Resize listener to readjust canvas display size and position if window changes
    window.addEventListener('resize', setupCanvas);
}

// --- Confirm and Export Mask ---
async function handleConfirmMask() {
    console.log("Confirm button clicked");
    tg.MainButton.showProgress(true); // Show loading indicator on button
    tg.MainButton.disable(); // Disable button during processing
    statusDiv.textContent = "Generating mask...";

    try {
        // Create a temporary canvas for export at original resolution
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = canvas.width; // Original image width
        exportCanvas.height = canvas.height; // Original image height
        const exportCtx = exportCanvas.getContext('2d');

        // 1. Fill with black (transparent becomes black)
        exportCtx.fillStyle = 'black';
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

        // 2. Draw the existing mask (white parts) onto the black background
        // This correctly composites the white strokes onto the black.
        exportCtx.drawImage(canvas, 0, 0);

        // 3. Convert to JPEG Blob
        exportCanvas.toBlob(async (blob) => {
            if (!blob) {
                 showError("Error: Could not create image blob.");
                 tg.MainButton.hideProgress();
                 tg.MainButton.enable();
                 return;
            }

            console.log(`Generated JPEG blob: ${blob.size} bytes`);
            statusDiv.textContent = `Mask generated (${(blob.size / 1024).toFixed(1)} KB). Uploading...`;

            // 4. Upload the Blob to the Bot Backend
            const formData = new FormData();
            formData.append('mask', blob, `mask_${sourceImageInfo.imageId}.jpg`);
            formData.append('imageId', sourceImageInfo.imageId); // Send ID back
            formData.append('userId', sourceImageInfo.userId); // Send User ID back

            try {
                // IMPORTANT: Replace '/upload-mask' with the actual endpoint
                // you will define in your Python bot's web server.
                const response = await fetch('/upload-mask', {
                    method: 'POST',
                    body: formData,
                });

                if (response.ok) {
                    const result = await response.text(); // Or response.json() if you send JSON back
                    console.log("Upload successful:", result);
                    statusDiv.textContent = "Mask uploaded successfully!";
                    // Send confirmation back to the bot via sendData
                    // The bot will use this to trigger the ComfyUI workflow
                    tg.sendData(JSON.stringify({
                        status: "mask_uploaded",
                        imageId: sourceImageInfo.imageId,
                        userId: sourceImageInfo.userId
                    }));

                    // Optionally close the Mini App after successful upload
                    setTimeout(() => tg.close(), 1500); // Close after 1.5 seconds

                } else {
                     const errorText = await response.text();
                     showError(`Error uploading mask: ${response.status} - ${errorText}`);
                     tg.MainButton.hideProgress();
                     tg.MainButton.enable();
                }
            } catch (uploadError) {
                 showError(`Network error during upload: ${uploadError.message}`);
                 console.error("Upload fetch error:", uploadError);
                 tg.MainButton.hideProgress();
                 tg.MainButton.enable();
            }

        }, 'image/jpeg', 0.9); // 90% JPEG quality

    } catch (error) {
        showError(`Error during mask generation: ${error.message}`);
        console.error("Mask generation error:", error);
        tg.MainButton.hideProgress();
        tg.MainButton.enable();
    }
}

// --- Start the App ---
initializeApp();