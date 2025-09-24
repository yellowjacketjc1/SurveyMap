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

        this.initializeEventListeners();
        this.setupPdfJs();
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
        const equipmentAction = document.getElementById('equipmentAction');
        const clearAllBtn = document.getElementById('clearAllBtn');

        addSmearBtn.addEventListener('click', () => this.toggleSmearTool('add'));
        removeSmearBtn.addEventListener('click', () => this.toggleSmearTool('remove'));
        addDoseBtn.addEventListener('click', () => this.toggleDoseTool('add'));
        removeDoseBtn.addEventListener('click', () => this.toggleDoseTool('remove'));
        equipmentAction.addEventListener('change', (e) => this.setTool('equipment', e.target.value));
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

        // Reset all button states
        addSmearBtn.classList.remove('active');
        removeSmearBtn.classList.remove('active');
        addDoseBtn.classList.remove('active');
        removeDoseBtn.classList.remove('active');

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
        } else {
            // Check if clicking on a smear for dragging (when no tool is active)
            if (!this.currentTool) {
                const smear = this.getSmearAtPosition(e);
                if (smear) {
                    this.startSmearDrag(e, smear);
                    return;
                }
            }
            this.startPan(e);
        }
    }

    handleMouseMove(e) {
        if (this.isDraggingSmear) {
            this.dragSmear(e);
        } else {
            this.pan(e);
        }
    }

    handleMouseUp(e) {
        if (this.isDraggingSmear) {
            this.endSmearDrag();
        } else {
            this.endPan();
        }
    }

    handleMouseLeave() {
        if (this.isDraggingSmear) {
            this.endSmearDrag();
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
        } else if (this.currentTool.type === 'equipment') {
            const equipmentType = document.getElementById('equipmentAction').value;
            this.annotations.equipment.push({
                x: pageX,
                y: pageY,
                type: equipmentType
            });
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

    startPan(e) {
        this.isDragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new SurveyMapApp();
});
