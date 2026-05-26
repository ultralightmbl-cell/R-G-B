/* ==========================================================================
   【ステップ1】動作機能モデル app.js (RGB 分解・色収差検証版)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // DOM要素の取得
  const dropZone = document.getElementById('drop-zone');
  const dropPlaceholder = document.getElementById('drop-placeholder');
  const btnSelectFile = document.getElementById('btn-select-file');
  const fileInput = document.getElementById('file-input');
  const canvasContainer = document.getElementById('canvas-container');
  const previewCanvas = document.getElementById('preview-canvas');
  const imageDimensions = document.getElementById('image-dimensions');
  
  // 保存モーダル関連要素
  const saveModal = document.getElementById('save-modal');
  const modalPreviewImage = document.getElementById('modal-preview-image');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnCloseModalBottom = document.getElementById('btn-close-modal-bottom');

  const btnReset = document.getElementById('btn-reset');
  const btnDownload = document.getElementById('btn-download');
  const selectBlend = document.getElementById('select-blend');

  // ハーフトーン要素の取得
  const selectHalftone = document.getElementById('select-halftone');
  const inputHalftoneSize = document.getElementById('input-halftone-size');
  const valHalftoneSize = document.getElementById('val-halftone-size');

  // スライダーと数値表示要素の定義 (R, G, B)
  const sliders = {
    rx: document.getElementById('shift-rx'),
    ry: document.getElementById('shift-ry'),
    ro: document.getElementById('shift-ro'),
    gx: document.getElementById('shift-gx'),
    gy: document.getElementById('shift-gy'),
    go: document.getElementById('shift-go'),
    bx: document.getElementById('shift-bx'),
    by: document.getElementById('shift-by'),
    bo: document.getElementById('shift-bo')
  };

  const valLabels = {
    rx: document.getElementById('val-rx'),
    ry: document.getElementById('val-ry'),
    ro: document.getElementById('val-ro'),
    gx: document.getElementById('val-gx'),
    gy: document.getElementById('val-gy'),
    go: document.getElementById('val-go'),
    bx: document.getElementById('val-bx'),
    by: document.getElementById('val-by'),
    bo: document.getElementById('val-bo')
  };

  // 各色の表示状態を管理するチェックボックス
  const visibilityInputs = {
    r: document.getElementById('visible-r'),
    g: document.getElementById('visible-g'),
    b: document.getElementById('visible-b')
  };

  // アプリケーション状態
  let originalImage = null;
  let previewWidth = 0;
  let previewHeight = 0;
  
  // 各色の分解済みオフスクリーンキャンバス
  let channels = {
    r: document.createElement('canvas'),
    g: document.createElement('canvas'),
    b: document.createElement('canvas')
  };

  // 【超最適化キャッシュ】ハーフトーン前の純粋な各チャンネルのプレビュー用ピクセル配列
  let rawPixels = {
    r: null,
    g: null,
    b: null
  };

  let isUpdatePending = false;
  const MAX_PREVIEW_DIMENSION = 1000; // プレビュー表示を1000pxの美しいフル高解像度に戻します

  /* ==========================================================================
     1. イベント制御（クリック・ドラッグ＆ドロップ競合の完全排除）
     ========================================================================== */

  // ブラウザ標準のファイルドロップ時の遷移を防ぐ
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  // ドラッグ中表示
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.remove('drag-over');
    }, false);
  });

  // ファイルがドロップされたとき
  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      handleImageFile(dt.files[0]);
    }
  });

  // 「ファイルを選択」ボタンがクリックされたとき
  btnSelectFile.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  // ドロップゾーン自体がクリックされたとき（画像がまだ読み込まれていないときのみ起動）
  dropZone.addEventListener('click', (e) => {
    if (!dropZone.classList.contains('has-image')) {
      if (e.target !== fileInput && e.target !== btnSelectFile) {
        fileInput.click();
      }
    }
  });

  // ファイルダイアログで選択されたとき
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleImageFile(fileInput.files[0]);
    }
  });

  // ハーフトーンスライダーの有効・無効状態を更新する制御関数
  function updateHalftoneSliderState() {
    if (selectHalftone.value === 'none') {
      inputHalftoneSize.disabled = true;
    } else {
      if (originalImage) {
        inputHalftoneSize.disabled = false;
      }
    }
  }

  // モバイル（スマホ・タブレット）環境の判定
  function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
  }

  // 保存用モーダルの制御
  function showSaveModal(dataUrl) {
    saveModal.style.display = 'flex';
    // クラス追加を別フレームに逃がしてトランジションを確実に動作させる
    requestAnimationFrame(() => {
      saveModal.classList.add('active');
    });
    modalPreviewImage.src = dataUrl;
  }

  function hideSaveModal() {
    saveModal.classList.remove('active');
    setTimeout(() => {
      saveModal.style.display = 'none';
      modalPreviewImage.src = ''; // メモリ解放
    }, 300); // CSS transition時間に同期
  }

  // 画像ファイルの読み込みと判定
  function handleImageFile(file) {
    const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(file.name);
    if (!isImage) {
      alert('Please upload an image file (PNG, JPEG, WebP, etc.).');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    originalImage = new Image();
    originalImage.onload = () => {
      setupWorkspace();
      URL.revokeObjectURL(objectUrl);
    };
    originalImage.onerror = () => {
      alert('Failed to load image.');
      URL.revokeObjectURL(objectUrl);
    };
    originalImage.src = objectUrl;
  }

  /* ==========================================================================
     2. ワークスペースの初期化とコントロール有効化
     ========================================================================== */

  function setupWorkspace() {
    if (!originalImage || originalImage.width === 0) return;

    imageDimensions.textContent = `ORIGINAL: ${originalImage.width} × ${originalImage.height} px`;

    // プレビュー表示用サイズ算出（縦横比維持、最大1000pxに収める）
    let w = originalImage.width;
    let h = originalImage.height;
    if (w > MAX_PREVIEW_DIMENSION || h > MAX_PREVIEW_DIMENSION) {
      if (w > h) {
        h = Math.round((h * MAX_PREVIEW_DIMENSION) / w);
        w = MAX_PREVIEW_DIMENSION;
      } else {
        w = Math.round((w * MAX_PREVIEW_DIMENSION) / h);
        h = MAX_PREVIEW_DIMENSION;
      }
    }

    previewWidth = w;
    previewHeight = h;

    previewCanvas.width = previewWidth;
    previewCanvas.height = previewHeight;

    // スライダーと表示チェックボックスの制御を有効化
    Object.values(sliders).forEach(slider => {
      slider.disabled = false;
    });
    Object.values(visibilityInputs).forEach(checkbox => {
      checkbox.disabled = false;
    });
    selectBlend.disabled = false;
    selectHalftone.disabled = false;
    updateHalftoneSliderState();
    btnReset.disabled = false;
    btnDownload.disabled = false;
    dropPlaceholder.style.display = 'none';
    canvasContainer.style.display = 'block';
    dropZone.classList.add('has-image');

    // 初回のみ純粋なRGBピクセルデータをメモリに一括キャッシュ (ドラッグ中のgetImageDataを完全ゼロにする)
    cacheRawRGBPixels();

    // RGB分離処理を実行
    processRGB();
    
    // 初回描画
    requestRender();
  }

  /* ==========================================================================
     3. 高精度 RGB 分離ロジック (加法混色モデル用)
     ========================================================================== */

  function processRGB() {
    if (!originalImage) return;

    // 各チャンネルキャンバスの初期設定
    Object.keys(channels).forEach(key => {
      channels[key].width = previewWidth;
      channels[key].height = previewHeight;
    });

    const ctxR = channels.r.getContext('2d');
    const ctxG = channels.g.getContext('2d');
    const gridSize = parseInt(inputHalftoneSize.value, 10);
    const halftoneType = selectHalftone.value;

    if (halftoneType !== 'none' && gridSize >= 4) {
      // ハーフトーン適用時は、メモリにキャッシュした配列から直接サンプリングして描画 (超軽量)
      applyHalftone(channels.r, 'r', '#ff0000', 75, gridSize, previewWidth, previewHeight);
      applyHalftone(channels.g, 'g', '#00ff00', 15, gridSize, previewWidth, previewHeight);
      applyHalftone(channels.b, 'b', '#0000ff', 45, gridSize, previewWidth, previewHeight);
    } else {
      // ハーフトーンなしの時は、キャッシュから一瞬でキャンバスにピクセルを復元するだけ
      restoreChannelsFromCache();
    }
  }

  /* ==========================================================================
     3.1 高精度 RGB 分離＆ピクセルキャッシュシステム (超爆速化コア)
     ========================================================================== */

  function cacheRawRGBPixels() {
    if (!originalImage) return;

    const w = previewWidth;
    const h = previewHeight;

    // R, G, B それぞれのピクセルデータをキャッシュするためのオフスクリーンキャンバス
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');

    // Rチャンネルキャッシュ
    tempCtx.clearRect(0, 0, w, h);
    tempCtx.drawImage(originalImage, 0, 0, w, h);
    tempCtx.globalCompositeOperation = 'source-in';
    tempCtx.fillStyle = '#ff0000';
    tempCtx.fillRect(0, 0, w, h);
    tempCtx.globalCompositeOperation = 'multiply';
    tempCtx.drawImage(originalImage, 0, 0, w, h);
    tempCtx.globalCompositeOperation = 'source-over';
    rawPixels.r = tempCtx.getImageData(0, 0, w, h).data;

    // Gチャンネルキャッシュ
    tempCtx.clearRect(0, 0, w, h);
    tempCtx.drawImage(originalImage, 0, 0, w, h);
    tempCtx.globalCompositeOperation = 'source-in';
    tempCtx.fillStyle = '#00ff00';
    tempCtx.fillRect(0, 0, w, h);
    tempCtx.globalCompositeOperation = 'multiply';
    tempCtx.drawImage(originalImage, 0, 0, w, h);
    tempCtx.globalCompositeOperation = 'source-over';
    rawPixels.g = tempCtx.getImageData(0, 0, w, h).data;

    // Bチャンネルキャッシュ
    tempCtx.clearRect(0, 0, w, h);
    tempCtx.drawImage(originalImage, 0, 0, w, h);
    tempCtx.globalCompositeOperation = 'source-in';
    tempCtx.fillStyle = '#0000ff';
    tempCtx.fillRect(0, 0, w, h);
    tempCtx.globalCompositeOperation = 'multiply';
    tempCtx.drawImage(originalImage, 0, 0, w, h);
    tempCtx.globalCompositeOperation = 'source-over';
    rawPixels.b = tempCtx.getImageData(0, 0, w, h).data;
  }

  function restoreChannelsFromCache() {
    const w = previewWidth;
    const h = previewHeight;

    ['r', 'g', 'b'].forEach(key => {
      const canvas = channels[key];
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      
      const imgData = ctx.createImageData(w, h);
      if (rawPixels[key]) {
        imgData.data.set(rawPixels[key]);
        ctx.putImageData(imgData, 0, 0);
      }
    });
  }

  /* ==========================================================================
     3.5 高度な斜め回転ハーフトーン (網点・万線) アルゴリズム
     ========================================================================== */

  function applyHalftone(canvas, channelKey, colorHex, angleDegrees, gridSize, w, h, customData = null) {
    const ctx = canvas.getContext('2d');
    
    // customDataがあればそれを使用（高解像度保存用）、なければキャッシュされた配列を直接参照 (プレビュー用)
    const data = customData ? customData : rawPixels[channelKey];
    if (!data) return;

    // 描画先キャンバスをクリア
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = colorHex;

    // 角度をラジアンに変換
    const angle = (angleDegrees * Math.PI) / 180;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const centerX = w / 2;
    const centerY = h / 2;

    const diag = Math.sqrt(w * w + h * h);
    const startX = -diag / 2;
    const endX = diag / 2;
    const startY = -diag / 2;
    const endY = diag / 2;

    // パスの一括処理開始
    ctx.beginPath();

    for (let gx = startX; gx < endX; gx += gridSize) {
      for (let gy = startY; gy < endY; gy += gridSize) {
        // 回転座標系 (gx, gy) から直交座標系 (rx, ry) へマッピング
        const rx = gx * cosA - gy * sinA + centerX;
        const ry = gx * sinA + gy * cosA + centerY;

        const ix = Math.round(rx);
        const iy = Math.round(ry);

        if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
          const idx = (iy * w + ix) * 4;
          const alpha = data[idx + 3];
          if (alpha === 0) continue;

          // 輝度のサンプリング
          let val = 0;
          if (channelKey === 'r') val = data[idx];
          else if (channelKey === 'g') val = data[idx + 1];
          else if (channelKey === 'b') val = data[idx + 2];

          const ratio = val / 255;
          if (ratio < 0.05) continue; // 暗すぎる部分は描画しない

          // 網点 (ドット) 描画 - 常に美しい円(arc)で滑らかに表現
          const maxRadius = (gridSize / 2) * 1.25;
          const r = maxRadius * ratio;
          ctx.moveTo(rx + r, ry);
          ctx.arc(rx, ry, r, 0, Math.PI * 2);
        }
      }
    }

    ctx.fill();
  }

  /* ==========================================================================
     4. 描画合成システム (加法混色モデル)
     ========================================================================== */

  function requestRender() {
    if (isUpdatePending) return;
    isUpdatePending = true;
    
    requestAnimationFrame(() => {
      renderComposite();
      isUpdatePending = false;
    });
  }

  function renderComposite() {
    if (!originalImage) return;

    const ctx = previewCanvas.getContext('2d');

    // ★重要：ブレンドモードを一旦標準に戻し、キャンバスを「完全透明」でクリアする！
    // 描画先が不透明な黒の状態でスクリーン/加算を重ねると、アルファ値の計算の都合上、
    // 光の純粋な加算が行われず、色が極めて暗く濁って（くすんで）しまいます。
    // 背景色の決定 (screen/lighter は黒背景、difference は白背景にして極彩色反転を起こす)
    ctx.globalCompositeOperation = 'source-over';
    if (selectBlend.value === 'difference') {
      ctx.fillStyle = '#ffffff';
    } else {
      ctx.fillStyle = '#000000';
    }
    ctx.fillRect(0, 0, previewWidth, previewHeight);

    // 各スライダー値（ズレ値）を取得
    const rx = parseInt(sliders.rx.value, 10);
    const ry = parseInt(sliders.ry.value, 10);
    const gx = parseInt(sliders.gx.value, 10);
    const gy = parseInt(sliders.gy.value, 10);
    const bx = parseInt(sliders.bx.value, 10);
    const by = parseInt(sliders.by.value, 10);

    // 表示が有効なレイヤーを抽出
    const layers = [];
    if (visibilityInputs.r.checked) layers.push({ key: 'r', x: rx, y: ry, opacity: parseInt(sliders.ro.value, 10) / 100 });
    if (visibilityInputs.g.checked) layers.push({ key: 'g', x: gx, y: gy, opacity: parseInt(sliders.go.value, 10) / 100 });
    if (visibilityInputs.b.checked) layers.push({ key: 'b', x: bx, y: by, opacity: parseInt(sliders.bo.value, 10) / 100 });

    layers.forEach((layer) => {
      // 指定されたブレンドモード（スクリーン/差の絶対値）を適用する
      ctx.globalCompositeOperation = selectBlend.value;
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(channels[layer.key], layer.x, layer.y);
    });

    // 描画後は透明度とブレンドモードを標準に戻しておく
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';

    // UIの数値ラベルを更新
    valLabels.rx.textContent = rx;
    valLabels.ry.textContent = ry;
    valLabels.ro.textContent = sliders.ro.value;
    valLabels.gx.textContent = gx;
    valLabels.gy.textContent = gy;
    valLabels.go.textContent = sliders.go.value;
    valLabels.bx.textContent = bx;
    valLabels.by.textContent = by;
    valLabels.bo.textContent = sliders.bo.value;
  }

  /* ==========================================================================
     5. オリジナル解像度での画像エクスポート（保存）
     ========================================================================== */

  function downloadHighResImage() {
    if (!originalImage) return;

    btnDownload.disabled = true;
    btnDownload.textContent = 'SAVING...';

    setTimeout(() => {
      const origW = originalImage.width;
      const origH = originalImage.height;
      const scale = origW / previewWidth;

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = origW;
      outputCanvas.height = origH;
      const outCtx = outputCanvas.getContext('2d');

      // 高解像度用の3チャンネルキャンバス生成
      const hResChannels = {
        r: document.createElement('canvas'),
        g: document.createElement('canvas'),
        b: document.createElement('canvas')
      };

      Object.keys(hResChannels).forEach(key => {
        hResChannels[key].width = origW;
        hResChannels[key].height = origH;
      });

      const ctxR = hResChannels.r.getContext('2d');
      const ctxG = hResChannels.g.getContext('2d');
      const ctxB = hResChannels.b.getContext('2d');

      // --- GPUによる超高速高解像度RGB分解（シンプル乗算方式） ---
      // R
      ctxR.clearRect(0, 0, origW, origH);
      ctxR.drawImage(originalImage, 0, 0, origW, origH);
      ctxR.globalCompositeOperation = 'multiply';
      ctxR.fillStyle = '#ff0000';
      ctxR.fillRect(0, 0, origW, origH);
      ctxR.globalCompositeOperation = 'source-over';

      // G
      ctxG.clearRect(0, 0, origW, origH);
      ctxG.drawImage(originalImage, 0, 0, origW, origH);
      ctxG.globalCompositeOperation = 'multiply';
      ctxG.fillStyle = '#00ff00';
      ctxG.fillRect(0, 0, origW, origH);
      ctxG.globalCompositeOperation = 'source-over';

      // B
      ctxB.clearRect(0, 0, origW, origH);
      ctxB.drawImage(originalImage, 0, 0, origW, origH);
      ctxB.globalCompositeOperation = 'multiply';
      ctxB.fillStyle = '#0000ff';
      ctxB.fillRect(0, 0, origW, origH);
      ctxB.globalCompositeOperation = 'source-over';

      // --- 高解像度保存時も同様にハーフトーンを適用 ---
      const baseGridSize = parseInt(inputHalftoneSize.value, 10);
      const halftoneType = selectHalftone.value;
      if (halftoneType !== 'none' && baseGridSize >= 4) {
        const hResGridSize = Math.round(baseGridSize * scale);
        
        // 高解像度保存時のみ一時的に高精度ピクセルデータを抽出して適用 (これ以外のドラッグ時はキャッシュを参照するため爆速)
        const rData = ctxR.getImageData(0, 0, origW, origH).data;
        const gData = ctxG.getImageData(0, 0, origW, origH).data;
        const bData = ctxB.getImageData(0, 0, origW, origH).data;

        applyHalftone(hResChannels.r, 'r', '#ff0000', 75, hResGridSize, origW, origH, rData);
        applyHalftone(hResChannels.g, 'g', '#00ff00', 15, hResGridSize, origW, origH, gData);
        applyHalftone(hResChannels.b, 'b', '#0000ff', 45, hResGridSize, origW, origH, bData);
      }

      // 高解像度保存時も同様に、ブレンドモードに合わせて背景色を切り替えてから合成
      outCtx.globalCompositeOperation = 'source-over';
      if (selectBlend.value === 'difference') {
        outCtx.fillStyle = '#ffffff';
      } else {
        outCtx.fillStyle = '#000000';
      }
      outCtx.fillRect(0, 0, origW, origH);

      // ズレ幅もオリジナルのスケールに合わせて増倍
      const rx = Math.round(parseInt(sliders.rx.value, 10) * scale);
      const ry = Math.round(parseInt(sliders.ry.value, 10) * scale);
      const gx = Math.round(parseInt(sliders.gx.value, 10) * scale);
      const gy = Math.round(parseInt(sliders.gy.value, 10) * scale);
      const bx = Math.round(parseInt(sliders.bx.value, 10) * scale);
      const by = Math.round(parseInt(sliders.by.value, 10) * scale);

      const hResLayers = [];
      if (visibilityInputs.r.checked) hResLayers.push({ key: 'r', x: rx, y: ry, opacity: parseInt(sliders.ro.value, 10) / 100 });
      if (visibilityInputs.g.checked) hResLayers.push({ key: 'g', x: gx, y: gy, opacity: parseInt(sliders.go.value, 10) / 100 });
      if (visibilityInputs.b.checked) hResLayers.push({ key: 'b', x: bx, y: by, opacity: parseInt(sliders.bo.value, 10) / 100 });

      hResLayers.forEach((layer) => {
        outCtx.globalCompositeOperation = selectBlend.value;
        outCtx.globalAlpha = layer.opacity;
        outCtx.drawImage(hResChannels[layer.key], layer.x, layer.y);
      });

      // 後処理（透明度とブレンドモードの初期化）
      outCtx.globalAlpha = 1.0;
      outCtx.globalCompositeOperation = 'source-over';

      // ダウンロード・保存処理
      const dataUrl = outputCanvas.toDataURL('image/png');

      if (isMobileDevice()) {
        // モバイル環境：長押し保存用モーダルを表示
        showSaveModal(dataUrl);
      } else {
        // デスクトップ環境：自動ダウンロードを実行
        const link = document.createElement('a');
        link.download = 'rgb_shifted_artwork.png';
        link.href = dataUrl;
        link.click();
      }

      btnDownload.disabled = false;
      btnDownload.textContent = 'SAVE';
    }, 150);
  }

  /* ==========================================================================
     6. イベントバインディング
     ========================================================================== */

  // すべてのスライダーの入力イベントを購読
  Object.values(sliders).forEach(slider => {
    slider.addEventListener('input', requestRender);
  });

  // 表示チェックボックスの変更イベントを購読
  Object.values(visibilityInputs).forEach(checkbox => {
    checkbox.addEventListener('change', requestRender);
  });

  // ブレンドモード選択の変更イベントを購読
  selectBlend.addEventListener('change', requestRender);

  // リセットボタン
  btnReset.addEventListener('click', () => {
    Object.values(sliders).forEach(slider => {
      // 透明度スライダー(ro, go, bo)は初期値100、ズレは0に戻す
      if (slider.id.endsWith('o')) {
        slider.value = 100;
      } else {
        slider.value = 0;
      }
    });
    Object.values(visibilityInputs).forEach(checkbox => {
      checkbox.checked = true;
    });
    selectBlend.value = 'screen';
    selectHalftone.value = 'none';
    inputHalftoneSize.value = 10;
    valHalftoneSize.textContent = '10';
    updateHalftoneSliderState();
    processRGB();
    requestRender();
  });

  // ハーフトーン選択イベント
  selectHalftone.addEventListener('change', () => {
    updateHalftoneSliderState();
    processRGB();
    requestRender();
  });

  // ハーフトーンサイズ変更イベント
  inputHalftoneSize.addEventListener('input', () => {
    const val = parseInt(inputHalftoneSize.value, 10);
    valHalftoneSize.textContent = val;
    processRGB();
    requestRender();
  });

  // 保存ボタン
  btnDownload.addEventListener('click', downloadHighResImage);

  // 保存用モーダルの閉じる操作のバインド
  btnCloseModal.addEventListener('click', hideSaveModal);
  btnCloseModalBottom.addEventListener('click', hideSaveModal);
  saveModal.addEventListener('click', (e) => {
    if (e.target === saveModal) {
      hideSaveModal();
    }
  });
});
