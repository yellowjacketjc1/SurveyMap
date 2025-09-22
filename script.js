class SurveyMapApp {
    constructor() {
        this.pdfDoc = null;
        this.currentPage = null;
        this.canvas = document.getElementById('mapCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.currentRotation = 0;
        this.currentScale = 1;
        this.originalImageData = null;

        this.initializeEventListeners();
        this.setupPdfJs();
    }

    setupPdfJs() {
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
    }

    initializeEventListeners() {
        const pdfInput = document.getElementById('pdfInput');
        const uploadArea = document.getElementById('uploadArea');
        const rotationSlider = document.getElementById('rotationSlider');
        const scaleSlider = document.getElementById('scaleSlider');
        const resetBtn = document.getElementById('resetBtn');
        const exportBtn = document.getElementById('exportBtn');

        // File input change
        pdfInput.addEventListener('change', (e) => this.handleFileSelect(e));

        // Drag and drop functionality
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') {
                this.loadPDF(files[0]);
            }
        });

        // Upload area click
        uploadArea.addEventListener('click', () => {
            pdfInput.click();
        });

        // Control sliders
        rotationSlider.addEventListener('input', (e) => {
            this.currentRotation = parseInt(e.target.value);
            document.getElementById('rotationValue').textContent = `${this.currentRotation}°`;
            this.updateCanvas();
        });

        scaleSlider.addEventListener('input', (e) => {
            this.currentScale = parseFloat(e.target.value);
            document.getElementById('scaleValue').textContent = `${Math.round(this.currentScale * 100)}%`;
            this.updateCanvas();
        });

        // Control buttons
        resetBtn.addEventListener('click', () => this.resetTransforms());
        exportBtn.addEventListener('click', () => this.exportMap());
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

            // Load first page
            await this.renderPage(1);

            // Show the workspace
            document.querySelector('.upload-section').style.display = 'none';
            document.getElementById('mapWorkspace').style.display = 'flex';

        } catch (error) {
            console.error('Error loading PDF:', error);
            alert('Error loading PDF. Please try again.');
        }
    }

    async renderPage(pageNum) {
        try {
            const page = await this.pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.5 });

            // Set canvas dimensions
            this.canvas.width = viewport.width;
            this.canvas.height = viewport.height;

            // Render PDF page to canvas
            const renderContext = {
                canvasContext: this.ctx,
                viewport: viewport
            };

            await page.render(renderContext).promise;

            // Store original image data for transformations
            this.originalImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            this.currentPage = page;

        } catch (error) {
            console.error('Error rendering page:', error);
        }
    }

    updateCanvas() {
        if (!this.originalImageData) return;

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Save context state
        this.ctx.save();

        // Move to center of canvas
        this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2);

        // Apply rotation
        this.ctx.rotate((this.currentRotation * Math.PI) / 180);

        // Apply scaling
        this.ctx.scale(this.currentScale, this.currentScale);

        // Create temporary canvas to hold original image
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.canvas.width;
        tempCanvas.height = this.canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(this.originalImageData, 0, 0);

        // Draw the transformed image
        this.ctx.drawImage(tempCanvas, -this.canvas.width / 2, -this.canvas.height / 2);

        // Restore context state
        this.ctx.restore();
    }

    resetTransforms() {
        this.currentRotation = 0;
        this.currentScale = 1;

        // Update sliders
        document.getElementById('rotationSlider').value = 0;
        document.getElementById('scaleSlider').value = 1;
        document.getElementById('rotationValue').textContent = '0°';
        document.getElementById('scaleValue').textContent = '100%';

        // Reset canvas
        if (this.originalImageData) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.putImageData(this.originalImageData, 0, 0);
        }
    }

    exportMap() {
        if (!this.canvas) {
            alert('No map loaded to export.');
            return;
        }

        // Create download link
        const link = document.createElement('a');
        link.download = 'survey_map.png';
        link.href = this.canvas.toDataURL();

        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new SurveyMapApp();
});