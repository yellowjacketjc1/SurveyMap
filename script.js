class SurveyMapApp {
    constructor() {
        // PDF and Page Data
        this.pdfDoc = null;
        this.pdfPage = null;

        // Main visible canvas
        this.canvas = document.getElementById('mapCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Off-screen canvas for high-res PDF rendering
        this.pageCanvas = document.createElement('canvas');
        this.pageCtx = this.pageCanvas.getContext('2d');

        // Transformation state
        this.rotation = 0;
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;

        // Panning state
        this.isDragging = false;
        this.lastX = 0;
        this.lastY = 0;

        // Editing state
        this.annotations = {
            smears: [],
            doseRates: [],
            equipment: []
        };
        this.nextSmearId = 1;
        this.currentTool = null;

        // Dragging state
        this.isDraggingSmear = false;
        this.draggedSmear = null;
        this.dragOffset = { x: 0, y: 0 };

        // Icon dragging state
        this.isDraggingIcon = false;
        this.dragPreview = null;
        this.currentDraggedIcon = null;

        // Icon selection and resizing state
        this.selectedIcon = null;
        this.isResizing = false;
        this.resizeHandle = null;
        this.isDraggingSelectedIcon = false;
        this.iconDragOffset = { x: 0, y: 0 };

        // Loaded icons
        this.loadedIcons = new Map();

        this.initializeEventListeners();
        this.setupPdfJs();
        this.loadIcons();
    }

    setupPdfJs() {
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        } else {
            console.error('PDF.js library not loaded');
            alert('PDF.js library failed to load. Please refresh the page.');
        }
    }

    initializeEventListeners() {
        const pdfInput = document.getElementById('pdfInput');
        const uploadArea = document.getElementById('uploadArea');
        const uploadBtn = document.getElementById('uploadBtn');
        const rotationSlider = document.getElementById('rotationSlider');
        const scaleSlider = document.getElementById('scaleSlider');
        const resetBtn = document.getElementById('resetBtn');
        const exportBtn = document.getElementById('exportBtn');
        const menuToggle = document.getElementById('menuToggle');
        const controlsPanel = document.getElementById('controlsPanel');

        // File handling
        pdfInput.addEventListener('change', (e) => this.handleFileSelect(e));
        uploadBtn.addEventListener('click', () => pdfInput.click());
        uploadArea.addEventListener('click', () => pdfInput.click());

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') {
                this.loadPDF(files[0]);
            }
        });

        // Control panel
        rotationSlider.addEventListener('input', (e) => {
            this.rotation = parseInt(e.target.value);
            document.getElementById('rotationValue').textContent = `${this.rotation}°`;
            this.redraw();
        });

        scaleSlider.addEventListener('input', (e) => {
            this.scale = parseFloat(e.target.value);
            document.getElementById('scaleValue').textContent = `${Math.round(this.scale * 100)}%`;
            this.redraw();
        });

        resetBtn.addEventListener('click', () => this.resetView());
        exportBtn.addEventListener('click', () => this.exportMap());

        // Menu toggle
        menuToggle.addEventListener('click', () => controlsPanel.classList.toggle('open'));
        document.addEventListener('click', (e) => {
            if (!controlsPanel.contains(e.target) && !menuToggle.contains(e.target)) {
                controlsPanel.classList.remove('open');
            }
        });

        // Canvas interactions
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('mouseleave', () => this.handleMouseLeave());
        this.canvas.addEventListener('wheel', (e) => this.handleZoom(e));

        // Responsive canvas
        window.addEventListener('resize', () => this.resetView());

        // Editing tools
        const addSmearBtn = document.getElementById('addSmearBtn');
        const removeSmearBtn = document.getElementById('removeSmearBtn');
        const addDoseBtn = document.getElementById('addDoseBtn');
        const removeDoseBtn = document.getElementById('removeDoseBtn');
        const deleteEquipmentBtn = document.getElementById('deleteEquipmentBtn');
        const clearAllBtn = document.getElementById('clearAllBtn');

        addSmearBtn.addEventListener('click', () => this.toggleSmearTool('add'));
        removeSmearBtn.addEventListener('click', () => this.toggleSmearTool('remove'));
        addDoseBtn.addEventListener('click', () => this.toggleDoseTool('add'));
        removeDoseBtn.addEventListener('click', () => this.toggleDoseTool('remove'));
        deleteEquipmentBtn.addEventListener('click', () => this.toggleEquipmentDeleteTool());
        clearAllBtn.addEventListener('click', () => this.clearAllAnnotations());
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file && file.type === 'application/pdf') {
            this.loadPDF(file);
        } else {
            alert('Please select a valid PDF file.');
        }
    }

    async loadPDF(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
            this.pdfDoc = pdf;
            this.pdfPage = await this.pdfDoc.getPage(1); // Load first page

            // Render to off-screen canvas at high resolution
            const pixelRatio = window.devicePixelRatio || 1;
            const viewport = this.pdfPage.getViewport({ scale: 2 * pixelRatio });
            this.pageCanvas.width = viewport.width;
            this.pageCanvas.height = viewport.height;
            
            await this.pdfPage.render({
                canvasContext: this.pageCtx,
                viewport: viewport,
            }).promise;
            
            // Show workspace and perform initial render
            document.getElementById('uploadSection').style.display = 'none';
            document.getElementById('mapWorkspace').style.display = 'flex';
            this.resetView();

        } catch (error) {
            console.error('Error loading PDF:', error);
            alert(`Error loading PDF: ${error.message}. Please try again.`);
        }
    }
    
    resetView() {
        if (!this.pdfPage) return;
        
        const container = document.getElementById('mapContainer');
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        
        // Calculate scale to fit the page inside the canvas
        const scaleX = this.canvas.width / this.pageCanvas.width;
        const scaleY = this.canvas.height / this.pageCanvas.height;
        this.scale = Math.min(scaleX, scaleY) * 0.95; // 95% to leave some padding

        // Center the page
        this.offsetX = (this.canvas.width - (this.pageCanvas.width * this.scale)) / 2;
        this.offsetY = (this.canvas.height - (this.pageCanvas.height * this.scale)) / 2;

        this.rotation = 0;
        
        // Update UI controls
        document.getElementById('rotationSlider').value = 0;
        document.getElementById('scaleSlider').value = this.scale;
        document.getElementById('rotationValue').textContent = '0°';
        document.getElementById('scaleValue').textContent = `${Math.round(this.scale * 100)}%`;
        
        this.redraw();
    }

    redraw() {
        if (!this.pdfPage) return;
        
        this.ctx.save();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.translate(this.offsetX, this.offsetY);

        // Apply rotation around the center of the visible part of the page
        const centerX = this.pageCanvas.width / 2;
        const centerY = this.pageCanvas.height / 2;
        this.ctx.translate(centerX * this.scale, centerY * this.scale);
        this.ctx.rotate((this.rotation * Math.PI) / 180);
        this.ctx.translate(-centerX * this.scale, -centerY * this.scale);

        this.ctx.scale(this.scale, this.scale);
        this.ctx.drawImage(this.pageCanvas, 0, 0);

        this.ctx.restore();

        // Draw annotations
        this.drawAnnotations();
    }
    
    startPan(e) {
        this.isDragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
    }

    pan(e) {
        if (!this.isDragging) return;
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.offsetX += dx;
        this.offsetY += dy;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.redraw();
    }

    endPan() {
        this.isDragging = false;
    }

    handleZoom(e) {
        e.preventDefault();
        const zoomIntensity = 0.1;
        const direction = e.deltaY < 0 ? 1 : -1;
        const scaleFactor = 1 + direction * zoomIntensity;
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Position of the mouse relative to the transformed page
        const worldX = (mouseX - this.offsetX) / this.scale;
        const worldY = (mouseY - this.offsetY) / this.scale;
        
        this.scale *= scaleFactor;
        
        // Adjust offset to keep the point under the mouse stationary
        this.offsetX = mouseX - worldX * this.scale;
        this.offsetY = mouseY - worldY * this.scale;
        
        // Update slider
        document.getElementById('scaleSlider').value = this.scale;
        document.getElementById('scaleValue').textContent = `${Math.round(this.scale * 100)}%`;

        this.redraw();
    }

    exportMap() {
        if (!this.pdfPage) {
            alert('No map loaded to export.');
            return;
        }
        const link = document.createElement('a');
        link.download = 'survey_map.png';
        link.href = this.canvas.toDataURL();
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Editing Methods
    toggleSmearTool(action) {
        // Toggle the tool - if it's already active, deactivate it
        if (this.currentTool && this.currentTool.type === 'smear' && this.currentTool.action === action) {
            this.currentTool = null;
        } else {
            this.currentTool = { type: 'smear', action };
        }

        this.updateButtonStates();
        this.updateCursor();
    }

    toggleDoseTool(action) {
        // Toggle the tool - if it's already active, deactivate it
        if (this.currentTool && this.currentTool.type === 'dose' && this.currentTool.action === action) {
            this.currentTool = null;
        } else {
            this.currentTool = { type: 'dose', action };
        }

        this.updateButtonStates();
        this.updateCursor();
        this.updateDoseControls();
    }

    updateButtonStates() {
        // Smear buttons
        const addSmearBtn = document.getElementById('addSmearBtn');
        const removeSmearBtn = document.getElementById('removeSmearBtn');

        // Dose buttons
        const addDoseBtn = document.getElementById('addDoseBtn');
        const removeDoseBtn = document.getElementById('removeDoseBtn');

        // Equipment button
        const deleteEquipmentBtn = document.getElementById('deleteEquipmentBtn');

        // Reset all button states
        addSmearBtn.classList.remove('active');
        removeSmearBtn.classList.remove('active');
        addDoseBtn.classList.remove('active');
        removeDoseBtn.classList.remove('active');
        deleteEquipmentBtn.classList.remove('active');

        // Set active state for current tool
        if (this.currentTool) {
            if (this.currentTool.type === 'smear') {
                if (this.currentTool.action === 'add') {
                    addSmearBtn.classList.add('active');
                } else if (this.currentTool.action === 'remove') {
                    removeSmearBtn.classList.add('active');
                }
            } else if (this.currentTool.type === 'dose') {
                if (this.currentTool.action === 'add') {
                    addDoseBtn.classList.add('active');
                } else if (this.currentTool.action === 'remove') {
                    removeDoseBtn.classList.add('active');
                }
            } else if (this.currentTool.type === 'equipment') {
                if (this.currentTool.action === 'delete') {
                    deleteEquipmentBtn.classList.add('active');
                }
            }
        }
    }

    updateDoseControls() {
        const doseControls = document.getElementById('doseControls');
        const showControls = this.currentTool &&
                           this.currentTool.type === 'dose' &&
                           this.currentTool.action === 'add';
        doseControls.style.display = showControls ? 'block' : 'none';
    }

    updateCursor() {
        if (this.isDraggingSmear) {
            this.canvas.style.cursor = 'grabbing';
        } else if (this.currentTool) {
            if (this.currentTool.action === 'add') {
                this.canvas.style.cursor = 'crosshair';
            } else if (this.currentTool.action === 'remove') {
                this.canvas.style.cursor = 'pointer';
            }
        } else {
            this.canvas.style.cursor = 'grab';
        }
    }

    setTool(type, action) {
        this.currentTool = action ? { type, action } : null;
        this.updateCursor();
    }

    handleMouseDown(e) {
        if (this.currentTool && this.currentTool.action === 'add') {
            this.addAnnotation(e);
        } else if (this.currentTool && this.currentTool.action === 'remove' && this.currentTool.type === 'smear') {
            this.removeSmear(e);
        } else if (this.currentTool && this.currentTool.action === 'remove' && this.currentTool.type === 'dose') {
            this.removeDoseRate(e);
        } else if (this.currentTool && this.currentTool.action === 'delete' && this.currentTool.type === 'equipment') {
            this.deleteEquipment(e);
        } else {
            // Check if clicking on an icon for selection/resizing (when no tool is active)
            if (!this.currentTool) {
                const iconClick = this.getIconAtPosition(e);
                if (iconClick) {
                    if (iconClick.isResizeHandle) {
                        this.startIconResize(e, iconClick.icon, iconClick.handle);
                        return;
                    } else {
                        this.selectIcon(iconClick.icon);
                        this.startSelectedIconDrag(e, iconClick.icon);
                        this.redraw();
                        return;
                    }
                }

                // Check if clicking on a smear for dragging
                const smear = this.getSmearAtPosition(e);
                if (smear) {
                    this.startSmearDrag(e, smear);
                    return;
                }

                // Clear icon selection if clicking elsewhere
                if (this.selectedIcon) {
                    this.selectedIcon = null;
                    this.redraw();
                }
            }
            this.startPan(e);
        }
    }

    handleMouseMove(e) {
        if (this.isDraggingSmear) {
            this.dragSmear(e);
        } else if (this.isResizing) {
            this.resizeIcon(e);
        } else if (this.isDraggingSelectedIcon) {
            this.dragSelectedIcon(e);
        } else {
            this.pan(e);
        }
    }

    handleMouseUp(e) {
        if (this.isDraggingSmear) {
            this.endSmearDrag();
        } else if (this.isResizing) {
            this.endIconResize();
        } else if (this.isDraggingSelectedIcon) {
            this.endSelectedIconDrag();
        } else {
            this.endPan();
        }
    }

    handleMouseLeave() {
        if (this.isDraggingSmear) {
            this.endSmearDrag();
        } else if (this.isResizing) {
            this.endIconResize();
        } else if (this.isDraggingSelectedIcon) {
            this.endSelectedIconDrag();
        } else {
            this.endPan();
        }
    }

    addAnnotation(e) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        // Convert canvas coordinates to page coordinates
        const pageX = (canvasX - this.offsetX) / this.scale;
        const pageY = (canvasY - this.offsetY) / this.scale;

        if (this.currentTool.type === 'smear') {
            this.annotations.smears.push({
                id: this.nextSmearId++,
                x: pageX,
                y: pageY
            });
            document.getElementById('nextSmearId').textContent = this.nextSmearId;
        } else if (this.currentTool.type === 'dose') {
            const doseValue = document.getElementById('doseValue').value;
            const doseUnit = document.getElementById('doseUnit').value;
            const doseType = document.querySelector('input[name="doseType"]:checked').value;

            if (doseValue) {
                this.annotations.doseRates.push({
                    x: pageX,
                    y: pageY,
                    value: parseFloat(doseValue),
                    unit: doseUnit,
                    type: doseType
                });
            }
        }

        this.redraw();
    }

    drawAnnotations() {
        this.ctx.save();
        this.ctx.translate(this.offsetX, this.offsetY);
        this.ctx.scale(this.scale, this.scale);

        // Draw smears
        this.annotations.smears.forEach(smear => {
            const isBeingDragged = this.isDraggingSmear && this.draggedSmear && this.draggedSmear.smear === smear;

            this.ctx.beginPath();
            this.ctx.arc(smear.x, smear.y, 15, 0, 2 * Math.PI);

            if (isBeingDragged) {
                // Highlight the dragged smear
                this.ctx.fillStyle = 'rgba(255, 152, 0, 0.8)';
                this.ctx.strokeStyle = '#ff9800';
                this.ctx.lineWidth = 3;
            } else {
                this.ctx.fillStyle = 'rgba(255, 193, 7, 0.6)';
                this.ctx.strokeStyle = '#ffc107';
                this.ctx.lineWidth = 2;
            }

            this.ctx.fill();
            this.ctx.stroke();

            // Draw ID number
            this.ctx.fillStyle = '#000';
            this.ctx.font = 'bold 12px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(smear.id.toString(), smear.x, smear.y + 4);
        });

        // Draw dose rates (text only)
        this.annotations.doseRates.forEach(dose => {
            const displayValue = `${dose.value} ${dose.unit || 'μR/hr'}`;

            // Set text properties
            this.ctx.fillStyle = '#000';
            this.ctx.font = 'bold 12px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';

            // Draw neutron indicator dot to the left of text
            if (dose.type === 'neutron') {
                // Measure text width to position dot correctly
                const textMetrics = this.ctx.measureText(displayValue);
                const textWidth = textMetrics.width;
                const dotX = dose.x - (textWidth / 2) - 8; // 8px to the left of text start

                this.ctx.beginPath();
                this.ctx.arc(dotX, dose.y, 3, 0, 2 * Math.PI);
                this.ctx.fillStyle = '#007bff';
                this.ctx.fill();

                // Reset text color for the dose value
                this.ctx.fillStyle = '#000';
            }

            // Draw dose value with unit
            this.ctx.fillText(displayValue, dose.x, dose.y);
        });

        // Draw equipment
        this.annotations.equipment.forEach(equipment => {
            if (equipment.type === 'icon' && equipment.iconSvg) {
                // Draw SVG icon
                this.drawSvgIcon(equipment);

                // Draw selection handles if this icon is selected
                if (this.selectedIcon === equipment) {
                    this.drawSelectionHandles(equipment);
                }
            } else {
                // Draw legacy equipment (rectangles for backward compatibility)
                this.ctx.beginPath();
                this.ctx.rect(equipment.x - 10, equipment.y - 10, 20, 20);
                this.ctx.fillStyle = 'rgba(40, 167, 69, 0.8)';
                this.ctx.fill();
                this.ctx.strokeStyle = '#28a745';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();

                // Draw equipment type
                this.ctx.fillStyle = '#000';
                this.ctx.font = 'bold 8px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(equipment.type.charAt(0).toUpperCase(), equipment.x, equipment.y + 3);
            }
        });

        this.ctx.restore();
    }

    removeSmear(e) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        // Convert canvas coordinates to page coordinates
        const pageX = (canvasX - this.offsetX) / this.scale;
        const pageY = (canvasY - this.offsetY) / this.scale;

        // Find the closest smear within clicking distance
        let closestSmear = null;
        let closestDistance = Infinity;
        const clickThreshold = 20; // pixels in page coordinates

        this.annotations.smears.forEach((smear, index) => {
            const distance = Math.sqrt(Math.pow(smear.x - pageX, 2) + Math.pow(smear.y - pageY, 2));
            if (distance < clickThreshold && distance < closestDistance) {
                closestDistance = distance;
                closestSmear = { smear, index };
            }
        });

        if (closestSmear) {
            // Remove the smear
            this.annotations.smears.splice(closestSmear.index, 1);

            // Renumber all remaining smears
            this.renumberSmears();

            this.redraw();
        }
    }

    removeDoseRate(e) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        // Convert canvas coordinates to page coordinates
        const pageX = (canvasX - this.offsetX) / this.scale;
        const pageY = (canvasY - this.offsetY) / this.scale;

        // Find the closest dose rate within clicking distance
        let closestDose = null;
        let closestDistance = Infinity;
        const clickThreshold = 30; // slightly larger threshold for text-based elements

        this.annotations.doseRates.forEach((dose, index) => {
            const distance = Math.sqrt(Math.pow(dose.x - pageX, 2) + Math.pow(dose.y - pageY, 2));
            if (distance < clickThreshold && distance < closestDistance) {
                closestDistance = distance;
                closestDose = { dose, index };
            }
        });

        if (closestDose) {
            // Remove the dose rate
            this.annotations.doseRates.splice(closestDose.index, 1);
            this.redraw();
        }
    }

    getSmearAtPosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        // Convert canvas coordinates to page coordinates
        const pageX = (canvasX - this.offsetX) / this.scale;
        const pageY = (canvasY - this.offsetY) / this.scale;

        // Find the closest smear within clicking distance
        let closestSmear = null;
        let closestDistance = Infinity;
        const clickThreshold = 20; // pixels in page coordinates

        this.annotations.smears.forEach((smear, index) => {
            const distance = Math.sqrt(Math.pow(smear.x - pageX, 2) + Math.pow(smear.y - pageY, 2));
            if (distance < clickThreshold && distance < closestDistance) {
                closestDistance = distance;
                closestSmear = { smear, index };
            }
        });

        return closestSmear;
    }

    startSmearDrag(e, smearData) {
        this.isDraggingSmear = true;
        this.draggedSmear = smearData;

        const rect = this.canvas.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        // Calculate offset from mouse to smear center
        const smearCanvasX = this.offsetX + (smearData.smear.x * this.scale);
        const smearCanvasY = this.offsetY + (smearData.smear.y * this.scale);

        this.dragOffset = {
            x: canvasX - smearCanvasX,
            y: canvasY - smearCanvasY
        };

        this.canvas.style.cursor = 'grabbing';
        e.preventDefault();
    }

    dragSmear(e) {
        if (!this.isDraggingSmear || !this.draggedSmear) return;

        const rect = this.canvas.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        // Convert to page coordinates, accounting for drag offset
        const pageX = (canvasX - this.offsetX - this.dragOffset.x) / this.scale;
        const pageY = (canvasY - this.offsetY - this.dragOffset.y) / this.scale;

        // Update smear position
        this.draggedSmear.smear.x = pageX;
        this.draggedSmear.smear.y = pageY;

        this.redraw();
    }

    endSmearDrag() {
        this.isDraggingSmear = false;
        this.draggedSmear = null;
        this.dragOffset = { x: 0, y: 0 };
        this.canvas.style.cursor = 'grab';
    }

    renumberSmears() {
        // Sort smears by their current ID to maintain consistent renumbering
        this.annotations.smears.sort((a, b) => a.id - b.id);

        // Reassign IDs starting from 1
        this.annotations.smears.forEach((smear, index) => {
            smear.id = index + 1;
        });

        // Update the next ID counter
        this.nextSmearId = this.annotations.smears.length + 1;
        document.getElementById('nextSmearId').textContent = this.nextSmearId;
    }

    clearAllAnnotations() {
        this.annotations.smears = [];
        this.annotations.doseRates = [];
        this.annotations.equipment = [];
        this.nextSmearId = 1;
        document.getElementById('nextSmearId').textContent = this.nextSmearId;
        this.redraw();
    }

    // Icon Management Methods
    async loadIcons() {
        console.log('Loading icons...');

        // Embedded icons that always work (fallback for file:// protocol)
        const embeddedIcons = {
            'drum-can-2-svgrepo-com.svg': `<svg version="1.1" id="_x32_" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
                width="800px" height="800px" viewBox="0 0 512 512"  xml:space="preserve">
                <style type="text/css">
                <![CDATA[
                    .st0{fill:#000000;}
                ]]>
                </style>
                <g>
                    <path class="st0" d="M191.266,42c-18.859,0-34.141,4.828-34.141,10.781c0,5.969,15.281,10.781,34.141,10.781
                        c18.844,0,34.141-4.813,34.141-10.781C225.406,46.828,210.109,42,191.266,42z"/>
                    <path class="st0" d="M434.906,189.5c0-6.313-3.344-12.406-9.422-18.094V74.594c6.078-5.688,9.422-11.781,9.422-18.094
                        C434.906,25.281,354.797,0,256,0S77.094,25.281,77.094,56.5c0,6.313,3.344,12.406,9.422,18.094v88.125
                        c1.391,1.375,2.953,2.719,4.766,4.063c8.438,6.344,21.313,12.406,37.422,17.469c32.234,10.188,77.422,16.625,127.297,16.594
                        c47.234,0.031,90.234-5.719,122.047-15l0,0c3-0.875,6.125,0.844,7,3.844s-0.844,6.125-3.844,7
                        C348,206.344,304.156,212.156,256,212.156c-33.375,0-64.688-2.781-91.813-7.719c-27.141-4.938-50.047-11.969-66.813-20.656
                        c-5.344-2.781-10.031-5.734-14.078-8.906c-3.969,4.672-6.203,9.563-6.203,14.625c0,6.344,3.344,12.406,9.422,18.094v86.672
                        c1.391,1.359,2.953,2.703,4.766,4.047c8.438,6.344,21.313,12.391,37.422,17.469c32.234,10.188,77.422,16.625,127.297,16.594
                        c47.234,0.031,90.234-5.719,122.047-15c3-0.875,6.125,0.844,7,3.844s-0.844,6.125-3.844,7C348,337.875,304.156,343.688,256,343.688
                        c-33.375,0-64.688-2.813-91.813-7.719c-27.141-4.938-50.047-11.938-66.813-20.656c-5-2.594-9.375-5.391-13.25-8.328
                        c-4.484,4.953-7.031,10.141-7.031,15.516c0,6.313,3.344,12.406,9.422,18.094v85.188c1.391,1.375,2.953,2.719,4.766,4.078
                        c8.438,6.328,21.313,12.375,37.422,17.453C160.938,457.5,206.125,463.938,256,463.906c47.234,0.031,90.234-5.719,122.047-15l0,0
                        c3-0.875,6.125,0.844,7,3.844s-0.844,6.125-3.844,7C348,469.406,304.156,475.219,256,475.219c-33.375,0-64.688-2.813-91.813-7.719
                        c-27.141-4.938-50.047-11.938-66.813-20.656c-4.656-2.438-8.75-5.031-12.438-7.75c-4.984,5.219-7.844,10.688-7.844,16.406
                        c0,31.219,80.109,56.5,178.906,56.5s178.906-25.281,178.906-56.5c0-6.313-3.344-12.391-9.422-18.078v-96.828
                        c6.078-5.688,9.422-11.75,9.422-18.094s-3.344-12.406-9.422-18.078v-96.828C431.563,201.906,434.906,195.844,434.906,189.5z
                         M256,91.813c-99.25,0-151.625-24.625-157.484-35.313C104.375,45.813,156.75,21.188,256,21.188S407.625,45.813,413.484,56.5
                        C407.625,67.188,355.25,91.813,256,91.813z"/>
                </g>
            </svg>`,
            'contamination-area-posting.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="300" height="400">
                <!-- Yellow background -->
                <rect width="300" height="400" fill="#FFFF00" stroke="#000000" stroke-width="4"/>

                <!-- Header section with magenta stripe -->
                <rect x="10" y="10" width="280" height="60" fill="#FF00FF"/>
                <text x="150" y="30" text-anchor="middle" fill="black" font-family="Arial, sans-serif" font-size="14" font-weight="bold">CAUTION</text>
                <text x="150" y="50" text-anchor="middle" fill="black" font-family="Arial, sans-serif" font-size="14" font-weight="bold">CONTAMINATION AREA</text>

                <!-- Main trefoil symbol (radiation symbol) -->
                <g transform="translate(150, 180)">
                    <!-- Central circle -->
                    <circle cx="0" cy="0" r="15" fill="black"/>

                    <!-- Three radiation blades -->
                    <g>
                        <!-- Blade 1 (top) -->
                        <path d="M 0,-15 L -25,-60 A 25,25 0 0,1 25,-60 Z" fill="black"/>
                        <!-- Blade 2 (bottom right) -->
                        <g transform="rotate(120)">
                            <path d="M 0,-15 L -25,-60 A 25,25 0 0,1 25,-60 Z" fill="black"/>
                        </g>
                        <!-- Blade 3 (bottom left) -->
                        <g transform="rotate(240)">
                            <path d="M 0,-15 L -25,-60 A 25,25 0 0,1 25,-60 Z" fill="black"/>
                        </g>
                    </g>

                    <!-- Yellow and black striped inner sections -->
                    <g>
                        <!-- Inner section 1 -->
                        <path d="M 0,-15 L -15,-35 A 15,15 0 0,1 15,-35 Z" fill="#FFFF00"/>
                        <!-- Inner section 2 -->
                        <g transform="rotate(120)">
                            <path d="M 0,-15 L -15,-35 A 15,15 0 0,1 15,-35 Z" fill="#FFFF00"/>
                        </g>
                        <!-- Inner section 3 -->
                        <g transform="rotate(240)">
                            <path d="M 0,-15 L -15,-35 A 15,15 0 0,1 15,-35 Z" fill="#FFFF00"/>
                        </g>
                    </g>
                </g>

                <!-- Warning text -->
                <text x="150" y="280" text-anchor="middle" fill="black" font-family="Arial, sans-serif" font-size="12" font-weight="bold">AUTHORIZED PERSONNEL ONLY</text>
                <text x="150" y="300" text-anchor="middle" fill="black" font-family="Arial, sans-serif" font-size="10">Any area accessible to individuals</text>
                <text x="150" y="315" text-anchor="middle" fill="black" font-family="Arial, sans-serif" font-size="10">where radioactive materials exist</text>
                <text x="150" y="330" text-anchor="middle" fill="black" font-family="Arial, sans-serif" font-size="10">in concentrations which result in</text>
                <text x="150" y="345" text-anchor="middle" fill="black" font-family="Arial, sans-serif" font-size="10">the major portion of the body</text>
                <text x="150" y="360" text-anchor="middle" fill="black" font-family="Arial, sans-serif" font-size="10">receiving more than 5 millirem</text>
                <text x="150" y="375" text-anchor="middle" fill="black" font-family="Arial, sans-serif" font-size="10">in any one hour, or 100 millirem</text>
                <text x="150" y="390" text-anchor="middle" fill="black" font-family="Arial, sans-serif" font-size="10">in any 5 consecutive days.</text>
            </svg>`
        };

        // Check if equipment list exists
        const equipmentList = document.getElementById('equipmentList');
        if (!equipmentList) {
            setTimeout(() => this.loadIcons(), 100);
            return;
        }

        // Clear any existing content and add debug info
        equipmentList.innerHTML = '';

        // Add a debug status item
        const debugItem = document.createElement('div');
        debugItem.style.padding = '10px';
        debugItem.style.background = '#e3f2fd';
        debugItem.style.border = '1px solid #2196f3';
        debugItem.style.borderRadius = '4px';
        debugItem.style.marginBottom = '10px';
        debugItem.innerHTML = '<strong>Loading Icons...</strong><br><span id="debug-status">Starting...</span>';
        equipmentList.appendChild(debugItem);

        const debugStatus = document.getElementById('debug-status');

        // First, load embedded icons (always work)
        debugStatus.textContent = 'Loading embedded icons...';
        Object.entries(embeddedIcons).forEach(([iconFile, svgText]) => {
            this.loadedIcons.set(iconFile, svgText);
            this.createEquipmentItem(iconFile, svgText);
        });
        debugStatus.textContent = `Loaded ${Object.keys(embeddedIcons).length} embedded icons`;

        // Try to load posting signs from Icons/Postings folder (requires server)
        const postingFiles = [];
        for (let i = 1; i <= 128; i++) {
            postingFiles.push(`Slide${i}.svg`);
        }

        let loadedFromFiles = 0;
        debugStatus.textContent = 'Loading posting files...';

        for (const postingFile of postingFiles) {
            try {
                const response = await fetch(`./Icons/Postings/${postingFile}`);
                if (response.ok) {
                    const svgText = await response.text();
                    this.loadedIcons.set(postingFile, svgText);
                    this.createEquipmentItem(postingFile, svgText);
                    loadedFromFiles++;

                    // Update debug status every 10 files
                    if (loadedFromFiles % 10 === 0) {
                        debugStatus.textContent = `Loaded ${loadedFromFiles} posting files...`;
                    }
                }
            } catch (error) {
                continue;
            }
        }

        // Final status
        const totalLoaded = Object.keys(embeddedIcons).length + loadedFromFiles;
        debugStatus.innerHTML = `<strong>Complete!</strong><br>Embedded: ${Object.keys(embeddedIcons).length}<br>Posting files: ${loadedFromFiles}<br>Total: ${totalLoaded}`;

        if (loadedFromFiles === 0) {
            debugStatus.innerHTML += '<br><span style="color: red;">No posting files loaded - check server</span>';
        }
    }

    createEquipmentItem(iconFile, svgText) {
        const equipmentList = document.getElementById('equipmentList');
        if (!equipmentList) return;

        const iconName = iconFile.replace('.svg', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        // Create a simple div with just text
        const equipmentItem = document.createElement('div');
        equipmentItem.style.padding = '10px';
        equipmentItem.style.background = 'white';
        equipmentItem.style.border = '1px solid #ccc';
        equipmentItem.style.marginBottom = '5px';
        equipmentItem.style.cursor = 'pointer';
        equipmentItem.style.fontSize = '14px';
        equipmentItem.style.fontWeight = 'bold';
        equipmentItem.textContent = iconName;

        // Add click handler to show the icon
        equipmentItem.onclick = () => {
            if (equipmentItem.expanded) {
                // Collapse - just show name
                equipmentItem.innerHTML = '';
                equipmentItem.textContent = iconName;
                equipmentItem.expanded = false;
            } else {
                // Expand - show name and icon
                equipmentItem.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 10px;">${iconName}</div>
                    <div style="border: 2px dashed #ccc; padding: 10px; text-align: center;">
                        <div class="icon-preview-container" style="width: 60px; height: 60px; margin: 0 auto; border: 1px solid #999; overflow: hidden; cursor: grab; display: flex; align-items: center; justify-content: center;">
                            <div style="width: 50px; height: 50px; overflow: hidden;">${svgText.replace(/width="[^"]*"/, 'width="50"').replace(/height="[^"]*"/, 'height="50"')}</div>
                        </div>
                        <div style="margin-top: 5px; font-size: 12px; color: #666;">Drag to place on map</div>
                    </div>
                `;

                // Add drag functionality to the container (not the scaled SVG)
                const iconPreview = equipmentItem.querySelector('.icon-preview-container');
                if (iconPreview) {
                    iconPreview.addEventListener('mousedown', (e) => this.startIconDrag(e, iconFile, svgText));
                    iconPreview.addEventListener('mouseenter', () => iconPreview.style.cursor = 'grab');
                    iconPreview.addEventListener('mousedown', () => iconPreview.style.cursor = 'grabbing');
                }
                equipmentItem.expanded = true;
            }
        };

        equipmentList.appendChild(equipmentItem);
    }

    drawSvgIcon(equipment) {
        // Create a more reliable data URL from the SVG
        const svg = equipment.iconSvg;
        const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));

        // Check if we've already created an image for this icon
        const cacheKey = `${equipment.iconFile}_${equipment.width}_${equipment.height}`;
        if (!this.iconImageCache) {
            this.iconImageCache = new Map();
        }

        let img = this.iconImageCache.get(cacheKey);
        if (!img) {
            img = new Image();
            img.onload = () => {
                this.redraw(); // Redraw when image loads
            };
            img.src = svgDataUrl;
            this.iconImageCache.set(cacheKey, img);
        }

        // Only draw if the image is loaded
        if (img.complete && img.naturalWidth > 0) {
            // Save current context state
            this.ctx.save();

            // Apply transformation for rotation if needed
            if (equipment.rotation) {
                this.ctx.translate(equipment.x, equipment.y);
                this.ctx.rotate((equipment.rotation * Math.PI) / 180);
                this.ctx.translate(-equipment.x, -equipment.y);
            }

            // Draw the image at the specified size
            this.ctx.drawImage(
                img,
                equipment.x - equipment.width / 2,
                equipment.y - equipment.height / 2,
                equipment.width,
                equipment.height
            );

            this.ctx.restore();
        } else {
            // Draw a placeholder rectangle while image loads
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
            this.ctx.strokeStyle = '#666';
            this.ctx.lineWidth = 1;
            this.ctx.fillRect(
                equipment.x - equipment.width / 2,
                equipment.y - equipment.height / 2,
                equipment.width,
                equipment.height
            );
            this.ctx.strokeRect(
                equipment.x - equipment.width / 2,
                equipment.y - equipment.height / 2,
                equipment.width,
                equipment.height
            );
            this.ctx.restore();
        }
    }

    startIconDrag(e, iconFile, svgText) {
        e.preventDefault();
        this.isDraggingIcon = true;
        this.currentDraggedIcon = { file: iconFile, svg: svgText };

        // Create drag preview
        this.dragPreview = document.createElement('div');
        this.dragPreview.className = 'drag-preview';
        this.dragPreview.innerHTML = svgText;
        document.body.appendChild(this.dragPreview);

        // Position drag preview
        this.updateDragPreview(e);

        // Add event listeners for dragging
        document.addEventListener('mousemove', this.handleIconDrag.bind(this));
        document.addEventListener('mouseup', this.endIconDrag.bind(this));

        // Add drag-over class to canvas
        this.canvas.classList.add('drag-over');
    }

    handleIconDrag(e) {
        if (!this.isDraggingIcon) return;
        this.updateDragPreview(e);
    }

    updateDragPreview(e) {
        if (this.dragPreview) {
            this.dragPreview.style.left = (e.clientX + 10) + 'px';
            this.dragPreview.style.top = (e.clientY - 10) + 'px';
        }
    }

    endIconDrag(e) {
        if (!this.isDraggingIcon) return;

        // Remove event listeners
        document.removeEventListener('mousemove', this.handleIconDrag.bind(this));
        document.removeEventListener('mouseup', this.endIconDrag.bind(this));

        // Check if dropped on canvas
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        if (canvasX >= 0 && canvasX <= rect.width && canvasY >= 0 && canvasY <= rect.height) {
            // Convert canvas coordinates to page coordinates, accounting for rotation
            let pageX, pageY;

            if (this.rotation === 0) {
                // Simple case - no rotation
                pageX = (canvasX - this.offsetX) / this.scale;
                pageY = (canvasY - this.offsetY) / this.scale;
            } else {
                // Account for rotation transformation
                const centerX = this.pageCanvas.width / 2;
                const centerY = this.pageCanvas.height / 2;

                // Translate to remove canvas offset and scale
                let x = (canvasX - this.offsetX) / this.scale;
                let y = (canvasY - this.offsetY) / this.scale;

                // Translate to origin (center of page)
                x -= centerX;
                y -= centerY;

                // Apply reverse rotation
                const cos = Math.cos((-this.rotation * Math.PI) / 180);
                const sin = Math.sin((-this.rotation * Math.PI) / 180);

                pageX = x * cos - y * sin + centerX;
                pageY = x * sin + y * cos + centerY;
            }

            // Add icon to equipment annotations
            this.annotations.equipment.push({
                x: pageX,
                y: pageY,
                type: 'icon',
                iconFile: this.currentDraggedIcon.file,
                iconSvg: this.currentDraggedIcon.svg,
                width: 80,
                height: 80,
                rotation: 0
            });

            this.redraw();
        }

        // Clean up
        if (this.dragPreview) {
            document.body.removeChild(this.dragPreview);
            this.dragPreview = null;
        }
        this.canvas.classList.remove('drag-over');
        this.isDraggingIcon = false;
        this.currentDraggedIcon = null;
    }

    // Icon selection and resizing methods
    getIconAtPosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        // Convert canvas coordinates to page coordinates, accounting for rotation
        let pageX, pageY;

        if (this.rotation === 0) {
            // Simple case - no rotation
            pageX = (canvasX - this.offsetX) / this.scale;
            pageY = (canvasY - this.offsetY) / this.scale;
        } else {
            // Account for rotation transformation
            const centerX = this.pageCanvas.width / 2;
            const centerY = this.pageCanvas.height / 2;

            // Translate to remove canvas offset and scale
            let x = (canvasX - this.offsetX) / this.scale;
            let y = (canvasY - this.offsetY) / this.scale;

            // Translate to origin (center of page)
            x -= centerX;
            y -= centerY;

            // Apply reverse rotation
            const cos = Math.cos((-this.rotation * Math.PI) / 180);
            const sin = Math.sin((-this.rotation * Math.PI) / 180);

            pageX = x * cos - y * sin + centerX;
            pageY = x * sin + y * cos + centerY;
        }

        // Check icons in reverse order (last drawn = on top)
        for (let i = this.annotations.equipment.length - 1; i >= 0; i--) {
            const equipment = this.annotations.equipment[i];
            if (equipment.type === 'icon') {
                // Check if clicking on resize handles first (if this icon is selected)
                if (this.selectedIcon === equipment) {
                    const handle = this.getResizeHandleAtPosition(equipment, pageX, pageY);
                    if (handle) {
                        return { icon: equipment, isResizeHandle: true, handle };
                    }
                }

                // Check if clicking on the icon itself
                const halfWidth = equipment.width / 2;
                const halfHeight = equipment.height / 2;
                if (pageX >= equipment.x - halfWidth && pageX <= equipment.x + halfWidth &&
                    pageY >= equipment.y - halfHeight && pageY <= equipment.y + halfHeight) {
                    return { icon: equipment, isResizeHandle: false };
                }
            }
        }

        return null;
    }

    getResizeHandleAtPosition(equipment, pageX, pageY) {
        const halfWidth = equipment.width / 2;
        const halfHeight = equipment.height / 2;
        const handleSize = 8 / this.scale; // Scale handle size with zoom
        const margin = 5 / this.scale;

        // Define handle positions
        const handles = [
            { name: 'nw', x: equipment.x - halfWidth - margin, y: equipment.y - halfHeight - margin },
            { name: 'ne', x: equipment.x + halfWidth + margin, y: equipment.y - halfHeight - margin },
            { name: 'sw', x: equipment.x - halfWidth - margin, y: equipment.y + halfHeight + margin },
            { name: 'se', x: equipment.x + halfWidth + margin, y: equipment.y + halfHeight + margin }
        ];

        for (const handle of handles) {
            if (pageX >= handle.x - handleSize && pageX <= handle.x + handleSize &&
                pageY >= handle.y - handleSize && pageY <= handle.y + handleSize) {
                return handle.name;
            }
        }

        return null;
    }

    selectIcon(icon) {
        this.selectedIcon = icon;
    }

    drawSelectionHandles(equipment) {
        const halfWidth = equipment.width / 2;
        const halfHeight = equipment.height / 2;
        const handleSize = 6;
        const margin = 5;

        // Draw selection border
        this.ctx.strokeStyle = '#3498db';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.strokeRect(
            equipment.x - halfWidth - margin,
            equipment.y - halfHeight - margin,
            equipment.width + margin * 2,
            equipment.height + margin * 2
        );
        this.ctx.setLineDash([]);

        // Draw resize handles
        this.ctx.fillStyle = '#3498db';
        const handles = [
            { x: equipment.x - halfWidth - margin, y: equipment.y - halfHeight - margin },
            { x: equipment.x + halfWidth + margin, y: equipment.y - halfHeight - margin },
            { x: equipment.x - halfWidth - margin, y: equipment.y + halfHeight + margin },
            { x: equipment.x + halfWidth + margin, y: equipment.y + halfHeight + margin }
        ];

        handles.forEach(handle => {
            this.ctx.fillRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
        });
    }

    startIconResize(_, icon, handle) {
        this.isResizing = true;
        this.selectedIcon = icon;
        this.resizeHandle = handle;
        this.canvas.style.cursor = this.getResizeCursor(handle);
    }

    resizeIcon(e) {
        if (!this.isResizing || !this.selectedIcon) return;

        const rect = this.canvas.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        // Convert canvas coordinates to page coordinates, accounting for rotation
        let pageX, pageY;

        if (this.rotation === 0) {
            // Simple case - no rotation
            pageX = (canvasX - this.offsetX) / this.scale;
            pageY = (canvasY - this.offsetY) / this.scale;
        } else {
            // Account for rotation transformation
            const centerX = this.pageCanvas.width / 2;
            const centerY = this.pageCanvas.height / 2;

            // Translate to remove canvas offset and scale
            let x = (canvasX - this.offsetX) / this.scale;
            let y = (canvasY - this.offsetY) / this.scale;

            // Translate to origin (center of page)
            x -= centerX;
            y -= centerY;

            // Apply reverse rotation
            const cos = Math.cos((-this.rotation * Math.PI) / 180);
            const sin = Math.sin((-this.rotation * Math.PI) / 180);

            pageX = x * cos - y * sin + centerX;
            pageY = x * sin + y * cos + centerY;
        }

        const icon = this.selectedIcon;
        const minSize = 20;
        const maxSize = 200;

        // Calculate new dimensions based on resize handle
        let newWidth = icon.width;
        let newHeight = icon.height;
        let newX = icon.x;
        let newY = icon.y;

        switch (this.resizeHandle) {
            case 'nw':
                newWidth = (icon.x + icon.width / 2) - pageX;
                newHeight = (icon.y + icon.height / 2) - pageY;
                newX = pageX + newWidth / 2;
                newY = pageY + newHeight / 2;
                break;
            case 'ne':
                newWidth = pageX - (icon.x - icon.width / 2);
                newHeight = (icon.y + icon.height / 2) - pageY;
                newX = icon.x - icon.width / 2 + newWidth / 2;
                newY = pageY + newHeight / 2;
                break;
            case 'sw':
                newWidth = (icon.x + icon.width / 2) - pageX;
                newHeight = pageY - (icon.y - icon.height / 2);
                newX = pageX + newWidth / 2;
                newY = icon.y - icon.height / 2 + newHeight / 2;
                break;
            case 'se':
                newWidth = pageX - (icon.x - icon.width / 2);
                newHeight = pageY - (icon.y - icon.height / 2);
                newX = icon.x - icon.width / 2 + newWidth / 2;
                newY = icon.y - icon.height / 2 + newHeight / 2;
                break;
        }

        // Clamp dimensions
        newWidth = Math.max(minSize, Math.min(maxSize, newWidth));
        newHeight = Math.max(minSize, Math.min(maxSize, newHeight));

        // Maintain aspect ratio
        const aspectRatio = icon.width / icon.height;
        if (newWidth / newHeight > aspectRatio) {
            newWidth = newHeight * aspectRatio;
        } else {
            newHeight = newWidth / aspectRatio;
        }

        // Update icon properties
        icon.width = newWidth;
        icon.height = newHeight;
        icon.x = newX;
        icon.y = newY;

        this.redraw();
    }

    endIconResize() {
        this.isResizing = false;
        this.resizeHandle = null;
        this.canvas.style.cursor = 'grab';
    }

    getResizeCursor(handle) {
        switch (handle) {
            case 'nw':
            case 'se':
                return 'nw-resize';
            case 'ne':
            case 'sw':
                return 'ne-resize';
            default:
                return 'grab';
        }
    }

    // Equipment delete functionality
    toggleEquipmentDeleteTool() {
        if (this.currentTool && this.currentTool.type === 'equipment' && this.currentTool.action === 'delete') {
            this.currentTool = null;
        } else {
            this.currentTool = { type: 'equipment', action: 'delete' };
        }
        this.updateButtonStates();
        this.updateCursor();
    }

    deleteEquipment(e) {
        const iconClick = this.getIconAtPosition(e);
        if (iconClick && iconClick.icon && iconClick.icon.type === 'icon') {
            // Find and remove the equipment
            const index = this.annotations.equipment.indexOf(iconClick.icon);
            if (index > -1) {
                this.annotations.equipment.splice(index, 1);
                // Clear selection if we deleted the selected icon
                if (this.selectedIcon === iconClick.icon) {
                    this.selectedIcon = null;
                }
                this.redraw();
            }
        }
    }

    // Selected icon dragging functionality
    startSelectedIconDrag(e, icon) {
        this.isDraggingSelectedIcon = true;

        const rect = this.canvas.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        // Convert to page coordinates to calculate offset
        let pageX, pageY;
        if (this.rotation === 0) {
            pageX = (canvasX - this.offsetX) / this.scale;
            pageY = (canvasY - this.offsetY) / this.scale;
        } else {
            const centerX = this.pageCanvas.width / 2;
            const centerY = this.pageCanvas.height / 2;
            let x = (canvasX - this.offsetX) / this.scale;
            let y = (canvasY - this.offsetY) / this.scale;
            x -= centerX;
            y -= centerY;
            const cos = Math.cos((-this.rotation * Math.PI) / 180);
            const sin = Math.sin((-this.rotation * Math.PI) / 180);
            pageX = x * cos - y * sin + centerX;
            pageY = x * sin + y * cos + centerY;
        }

        this.iconDragOffset = {
            x: pageX - icon.x,
            y: pageY - icon.y
        };

        this.canvas.style.cursor = 'grabbing';
    }

    dragSelectedIcon(e) {
        if (!this.isDraggingSelectedIcon || !this.selectedIcon) return;

        const rect = this.canvas.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        // Convert to page coordinates
        let pageX, pageY;
        if (this.rotation === 0) {
            pageX = (canvasX - this.offsetX) / this.scale;
            pageY = (canvasY - this.offsetY) / this.scale;
        } else {
            const centerX = this.pageCanvas.width / 2;
            const centerY = this.pageCanvas.height / 2;
            let x = (canvasX - this.offsetX) / this.scale;
            let y = (canvasY - this.offsetY) / this.scale;
            x -= centerX;
            y -= centerY;
            const cos = Math.cos((-this.rotation * Math.PI) / 180);
            const sin = Math.sin((-this.rotation * Math.PI) / 180);
            pageX = x * cos - y * sin + centerX;
            pageY = x * sin + y * cos + centerY;
        }

        // Update icon position, accounting for drag offset
        this.selectedIcon.x = pageX - this.iconDragOffset.x;
        this.selectedIcon.y = pageY - this.iconDragOffset.y;

        this.redraw();
    }

    endSelectedIconDrag() {
        this.isDraggingSelectedIcon = false;
        this.iconDragOffset = { x: 0, y: 0 };
        this.canvas.style.cursor = 'grab';
    }

    startPan(e) {
        this.isDragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new SurveyMapApp();
});
