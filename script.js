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
    let lastX = 0;
    let lastY = 0;
    let brushSize = parseInt(brushSizeSlider.value, 10);
    let history = [];
    let historyLimit = 20;
    let originalImageWidth = 0;
    let originalImageHeight = 0;
    let imageId = null;
    let panzoomInstance = null;
    let currentTool = 'draw';

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

            // Устанавливаем размер контейнера ТОЧНО по размеру изображения
            imageCanvasContainer.style.width = `${originalImageWidth}px`;
            imageCanvasContainer.style.height = `${originalImageHeight}px`;

            // Устанавливаем размер холста ТОЧНО по размеру изображения
            canvas.width = originalImageWidth;
            canvas.height = originalImageHeight;

            clearCanvas(); // Очищаем холст
            saveHistory(); // Сохраняем начальное чистое состояние

            // Инициализируем Panzoom ПОСЛЕ установки размеров
            setupPanzoom();

            // Важно: Вписываем и центрируем контент ПОСЛЕ инициализации Panzoom
            // Используем setTimeout, чтобы гарантировать, что DOM обновлен
             setTimeout(fitAndCenterContent, 50); // Небольшая задержка

            showLoader(false);
            tg.ready();
            console.log(`Canvas initialized: ${canvas.width}x${canvas.height}. Image ID: ${imageId}`);
            updateToolUI(); // Применяем начальное состояние инструмента
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
        panzoomInstance = Panzoom(imageCanvasContainer, { // Элемент для пана/зума
            maxScale: 10,
            minScale: 0.1, // Уменьшил minScale для лучшего вписывания
            contain: 'outside', // Позволяет контенту быть больше вьюпорта
            canvas: true, // Оптимизация для canvas
            // Начальное состояние - инструмент "Кисть", Panzoom выключен
            disablePan: true,
            disableZoom: true,
             handleStartEvent: e => {
                // Если активен инструмент "Кисть", Panzoom НЕ должен обрабатывать событие
                if (currentTool === 'draw') {
                    // Не вызываем preventDefault, позволяем нашим обработчикам рисования работать
                     return; // Говорим Panzoom игнорировать это событие
                 }
                 // Если активен инструмент "Рука" (Pan),
                 // и событие не мультитач (его Panzoom обработает сам для pinch-zoom)
                 if (currentTool === 'pan' && !(e.touches && e.touches.length > 1)) {
                     e.preventDefault(); // Предотвращаем действия браузера по умолчанию (скролл, drag)
                     // e.stopImmediatePropagation(); // Раскомментировать, если есть конфликты
                 }
                 // В остальных случаях (мультитач для pinch-zoom) Panzoom обработает событие сам
             },
            // Убрали начальные X, Y, scale - будем задавать через zoomToFit / reset
        });

        // Слушатели Panzoom
        panzoomWrapper.addEventListener('wheel', handleWheelZoom, { passive: false });
        imageCanvasContainer.addEventListener('panzoomchange', handlePanzoomChange); // Следим за изменениями пана/зума
        console.log("Panzoom initialized");
    }

    // --- Центрирование и вписывание контента ---
     function fitAndCenterContent() {
         if (!panzoomInstance || !panzoomWrapper || originalImageWidth === 0) {
             console.warn("Cannot fit content: Panzoom not ready or dimensions unknown.");
             return;
         }
         console.log("Attempting to fit and center content...");
         const wrapperRect = panzoomWrapper.getBoundingClientRect();
         const currentScale = panzoomInstance.getScale(); // Текущий масштаб

         // Рассчитываем масштаб, чтобы вписать изображение
         const scaleX = wrapperRect.width / originalImageWidth;
         const scaleY = wrapperRect.height / originalImageHeight;
         let targetScale = Math.min(scaleX, scaleY); // Вписываем полностью

         // Ограничиваем минимальный/максимальный масштаб из настроек Panzoom
         const minScale = panzoomInstance.options.minScale || 0.1;
         const maxScale = panzoomInstance.options.maxScale || 10;
         targetScale = Math.max(minScale, Math.min(maxScale, targetScale));

         // Центрируем
         // Координаты центра wrapper'а
         const wrapperCenterX = wrapperRect.width / 2;
         const wrapperCenterY = wrapperRect.height / 2;
         // Координаты центра контента ПОСЛЕ масштабирования
         const contentCenterX = (originalImageWidth / 2) * targetScale;
         const contentCenterY = (originalImageHeight / 2) * targetScale;
         // Смещение (pan), чтобы центры совпали
         const targetX = wrapperCenterX - contentCenterX;
         const targetY = wrapperCenterY - contentCenterY;

         // Применяем масштаб и позицию с помощью reset
         // reset: плавно анимирует переход
         // panzoomInstance.reset({ scale: targetScale, x: targetX, y: targetY }); // Используем reset для плавности
          // ИЛИ Используем zoom и pan для мгновенного применения:
          panzoomInstance.zoom(targetScale, { animate: false });
          panzoomInstance.pan(targetX, targetY, { animate: false });

         console.log(`Content fitted. Target Scale: ${targetScale.toFixed(3)}, Target Pan: ${targetX.toFixed(1)}, ${targetY.toFixed(1)}`);
         updateBrushSizeDisplay(); // Обновляем курсор после изменения масштаба
     }


    function handleWheelZoom(event) {
        if (currentTool === 'pan' && panzoomInstance) {
            // Prevent default page scroll ONLY when zooming inside the wrapper
            event.preventDefault();
            panzoomInstance.zoomWithWheel(event);
        }
    }

    function handlePanzoomChange(event) {
        // event.detail contains { x, y, scale, isPanning }
        // Обновляем размер кисти при изменении масштаба
        updateBrushSizeDisplay();
    }

    // --- Tool Switching ---
    function setTool(tool) {
        if (tool === currentTool || (tool !== 'draw' && tool !== 'pan')) return;
        currentTool = tool;
        console.log("Tool changed to:", currentTool);
        updateToolUI();
    }

    function updateToolUI() {
        const isDraw = currentTool === 'draw';
        const isPan = currentTool === 'pan';

        toolDrawButton.classList.toggle('active', isDraw);
        toolPanButton.classList.toggle('active', isPan);

        // Управляем классами на РОДИТЕЛЬСКИХ элементах для CSS правил (курсор и т.д.)
        drawingArea.classList.toggle('tool-draw', isDraw);
        drawingArea.classList.toggle('tool-pan', isPan);
        panzoomWrapper.classList.toggle('tool-draw', isDraw); // Для стилей курсора на wrapper
        panzoomWrapper.classList.toggle('tool-pan', isPan);

        // --- Enable/Disable Panzoom ---
        if (panzoomInstance) {
            panzoomInstance.setOptions({
                disablePan: isDraw, // Выключаем пан для кисти
                disableZoom: isDraw // Выключаем зум panzoom'а для кисти (браузерный pinch может работать)
            });
        }

        // --- Управляем touch-action на ОБЕРТКЕ Panzoom ---
        // 'none': Panzoom полностью управляет касаниями (для pan tool)
        // 'pinch-zoom pan-x pan-y': Разрешаем браузеру обрабатывать щипок/скролл (для draw tool)
        panzoomWrapper.style.touchAction = isPan ? 'none' : 'pinch-zoom pan-x pan-y';

        // Обновляем видимость и стиль курсора
        updateCustomCursor();
    }


    // --- Canvas and Drawing Logic ---
    function clearCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function draw(e) {
        if (currentTool !== 'draw' || !isDrawing || !panzoomInstance) return;
        const { x, y } = getCanvasCoordinates(e);
        if (isNaN(x) || isNaN(y)) return;

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
        if (currentTool !== 'draw') return;
        isDrawing = true;
        saveHistory();
        const { x, y } = getCanvasCoordinates(e);
        if (isNaN(x) || isNaN(y)) { isDrawing = false; return; }
        [lastX, lastY] = [x, y];

        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
    }

    function stopDrawing() {
        if (isDrawing) { isDrawing = false; }
    }

    // --- Coordinate Calculation (ОСТАВЛЯЕМ БЕЗ ИЗМЕНЕНИЙ, ЛОГИКА ВЕРНА) ---
    function getCanvasCoordinates(e) {
        if (!panzoomInstance) return { x: NaN, y: NaN };
        let clientX, clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX; clientY = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches.length > 0) {
             clientX = e.changedTouches[0].clientX; clientY = e.changedTouches[0].clientY;
        } else if (typeof e.clientX !== 'undefined') {
            clientX = e.clientX; clientY = e.clientY;
        } else { return { x: NaN, y: NaN }; }

        const wrapperRect = panzoomWrapper.getBoundingClientRect();
        const pointerX = clientX - wrapperRect.left;
        const pointerY = clientY - wrapperRect.top;
        const scale = panzoomInstance.getScale();
        const pan = panzoomInstance.getPan();
        const canvasX = (pointerX - pan.x) / scale;
        const canvasY = (pointerY - pan.y) / scale;
        // console.log(`CanvasXY: ${canvasX.toFixed(1)},${canvasY.toFixed(1)}`);
        return { x: canvasX, y: canvasY };
    }


    // --- History (Undo) Logic ---
    function saveHistory() {
        if (history.length >= historyLimit) { history.shift(); }
        try {
            if (canvas.width > 0 && canvas.height > 0) {
                 history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
            } else { console.warn("Attempted history save with zero canvas dimensions."); }
        } catch (e) { console.error("History save error:", e); showError("Ошибка сохранения состояния для отмены."); }
    }
    function undoLast() {
        if (history.length > 1) {
            history.pop(); ctx.putImageData(history[history.length - 1], 0, 0);
            console.log("Undo performed.");
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
        brushSize = parseInt(brushSizeSlider.value, 10); updateBrushSizeDisplay();
    }
    function updateCustomCursor(e) {
        if (currentTool !== 'draw') { customCursor.style.display = 'none'; return; }
        if (e) {
             const rect = drawingArea.getBoundingClientRect();
             let clientX, clientY;
             if (e.touches) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
             else { clientX = e.clientX; clientY = e.clientY; }
             // Ensure cursor stays within drawingArea bounds visually (optional)
             const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
             const y = Math.max(0, Math.min(clientY - rect.top, rect.height));
             customCursor.style.left = `${x}px`;
             customCursor.style.top = `${y}px`;
        }
        customCursor.style.display = 'block';
        updateBrushSizeDisplay();
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        toolDrawButton.addEventListener('click', () => setTool('draw'));
        toolPanButton.addEventListener('click', () => setTool('pan'));

        // Cursor visibility controlled by drawingArea
        drawingArea.addEventListener('mouseenter', updateCustomCursor);
        drawingArea.addEventListener('mouseleave', () => {
            customCursor.style.display = 'none';
            if (isDrawing) { stopDrawing(); } // Stop drawing if mouse leaves while pressed
        });
        drawingArea.addEventListener('mousemove', updateCustomCursor);

        // --- Drawing Listeners Directly on Canvas ---
        // Mouse
        canvas.addEventListener('mousedown', (e) => { if (currentTool === 'draw') startDrawing(e); });
        canvas.addEventListener('mousemove', (e) => { if (currentTool === 'draw' && isDrawing) draw(e); });
        canvas.addEventListener('mouseup', (e) => { if (currentTool === 'draw') stopDrawing(); });
        canvas.addEventListener('mouseleave', (e) => { if (currentTool === 'draw' && isDrawing) stopDrawing(); }); // Stop drawing if mouse leaves canvas

        // Touch - Using passive: false where preventDefault might be called
        canvas.addEventListener('touchstart', (e) => {
            if (currentTool === 'draw' && e.touches.length === 1) {
                e.preventDefault(); // Prevent scroll/zoom on drawing start
                startDrawing(e);
            }
        }, { passive: false });

        canvas.addEventListener('touchmove', (e) => {
            if (currentTool === 'draw' && isDrawing && e.touches.length === 1) {
                e.preventDefault(); // Prevent scroll/zoom while drawing
                draw(e);
                updateCustomCursor(e); // Move cursor with touch
            }
        }, { passive: false });

        canvas.addEventListener('touchend', (e) => {
            if (currentTool === 'draw' && isDrawing && e.changedTouches.length === 1) {
                 stopDrawing();
            }
            // customCursor.style.display = 'none'; // Hide cursor on touch end
         }, { passive: true }); // Can be passive

        canvas.addEventListener('touchcancel', (e) => {
             if (currentTool === 'draw' && isDrawing) { stopDrawing(); }
             // customCursor.style.display = 'none';
         }, { passive: true }); // Can be passive

        // --- Controls ---
        brushSizeSlider.addEventListener('input', handleBrushSizeChange);
        document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key?.toLowerCase() === 'z') { e.preventDefault(); undoLast(); } });
        confirmButton.addEventListener('click', handleConfirm);
        window.addEventListener('resize', () => {
             // Refit content on resize
             fitAndCenterContent();
             // panzoomInstance?.resize(); // Panzoom's internal resize handling
             updateBrushSizeDisplay();
         });
    }

    // --- Confirmation and Data Sending ---
    function handleConfirm() {
        console.log('Confirm button clicked...');
        errorMessage.textContent = ''; confirmButton.disabled = true; confirmButton.textContent = 'Обработка...';
        setTimeout(() => {
            try {
                const currentState = ctx.getImageData(0, 0, canvas.width, canvas.height);
                ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = 'black'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                const quality = 0.9; const dataUrl = canvas.toDataURL('image/jpeg', quality);
                ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.putImageData(currentState, 0, 0); ctx.globalCompositeOperation = 'source-over';
                const base64Data = dataUrl.split(',')[1];
                if (!base64Data) throw new Error("Failed to extract Base64 data.");
                const dataToSend = { maskData: base64Data, imageId: imageId };
                tg.sendData(JSON.stringify(dataToSend)); console.log('Data sent.');
                // tg.close();
            } catch (error) {
                console.error("Error confirming:", error); showError(`Ошибка: ${error.message}`);
                confirmButton.disabled = false; confirmButton.textContent = 'Подтвердить'; ctx.globalCompositeOperation = 'source-over';
            }
        }, 10);
    }

    // --- Start ---
    init();
});