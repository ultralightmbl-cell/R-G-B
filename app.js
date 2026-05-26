/* ==========================================================================
   【ステップ1】動作機能モデル app.js (RGB 分解・色収差検証版)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // DOM要素の取得
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const canvasContainer = document.getElementById('canvas-container');
  const previewCanvas = document.getElementById('preview-canvas');
  const imageDimensions = document.getElementById('image-dimensions');
  
  const btnReset = document.getElementById('btn-reset');
  const btnDownload = document.getElementById('btn-download');
  const selectBlend = document.getElementById('select-blend');

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

  let isUpdatePending = false;
  const MAX_PREVIEW_DIMENSION = 1000;

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

  // ドロップゾーン自体がクリックされたとき（file-inputをクリックした場合は除く）
  dropZone.addEventListener('click', (e) => {
    if (e.target !== fileInput) {
      fileInput.click();
    }
  });

  // ファイルダイアログで選択されたとき
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleImageFile(fileInput.files[0]);
    }
  });

  // 画像ファイルの読み込みと判定
  function handleImageFile(file) {
    const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(file.name);
    if (!isImage) {
      alert('画像ファイルをアップロードしてください（PNG, JPEG, WebP等）');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      originalImage = new Image();
      originalImage.onload = () => {
        setupWorkspace();
      };
      originalImage.onerror = () => {
        alert('画像の読み込みに失敗しました。');
      };
      originalImage.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ==========================================================================
     2. ワークスペースの初期化とコントロール有効化
     ========================================================================== */

  function setupWorkspace() {
    if (!originalImage || originalImage.width === 0) return;

    imageDimensions.textContent = `オリジナルサイズ: ${originalImage.width} × ${originalImage.height} px`;

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
    btnReset.disabled = false;
    btnDownload.disabled = false;
    canvasContainer.style.display = 'block';

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

    // 元画像を取得するオフスクリーンキャンバス
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = previewWidth;
    tempCanvas.height = previewHeight;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);

    const imgData = tempCtx.getImageData(0, 0, previewWidth, previewHeight);
    const data = imgData.data;

    // 各チャンネルキャンバスの初期設定
    Object.keys(channels).forEach(key => {
      channels[key].width = previewWidth;
      channels[key].height = previewHeight;
    });

    const ctxR = channels.r.getContext('2d');
    const ctxG = channels.g.getContext('2d');
    const ctxB = channels.b.getContext('2d');

    // 【重要：透過＆元のアルファ保持モデルへの変更】
    // 完全に透明（R:0, G:0, B:0, A:0）な状態で新規作成します
    const rData = ctxR.createImageData(previewWidth, previewHeight);
    const gData = ctxG.createImageData(previewWidth, previewHeight);
    const bData = ctxB.createImageData(previewWidth, previewHeight);

    const len = data.length;

    // 各チャンネルのピクセルデータを抽出（元の画像の透明度/アルファ値をそのまま引き継ぐ）
    for (let i = 0; i < len; i += 4) {
      const alpha = data[i+3];
      if (alpha > 0) {
        rData.data[i] = data[i];       // 赤成分
        rData.data[i+3] = alpha;       // 元のアルファ値
        
        gData.data[i+1] = data[i+1];   // 緑成分
        gData.data[i+3] = alpha;       // 元のアルファ値
        
        bData.data[i+2] = data[i+2];   // 青成分
        bData.data[i+3] = alpha;       // 元のアルファ値
      }
    }

    // 描画バッファへピクセルデータを適用
    ctxR.putImageData(rData, 0, 0);
    ctxG.putImageData(gData, 0, 0);
    ctxB.putImageData(bData, 0, 0);
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
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, previewWidth, previewHeight);

    // 各スライダー値（ズレ値）を取得
    const rx = parseInt(sliders.rx.value, 10);
    const ry = parseInt(sliders.ry.value, 10);
    const gx = parseInt(sliders.gx.value, 10);
    const gy = parseInt(sliders.gy.value, 10);
    const bx = parseInt(sliders.bx.value, 10);
    const by = parseInt(sliders.by.value, 10);

    // 表示が有効なレイヤーのうち、最初に描画するものを決定する
    // (1層目はブレンドする必要がないため、source-over（標準）で100%鮮明に描画します)
    const layers = [];
    if (visibilityInputs.r.checked) layers.push({ key: 'r', x: rx, y: ry, opacity: parseInt(sliders.ro.value, 10) / 100 });
    if (visibilityInputs.g.checked) layers.push({ key: 'g', x: gx, y: gy, opacity: parseInt(sliders.go.value, 10) / 100 });
    if (visibilityInputs.b.checked) layers.push({ key: 'b', x: bx, y: by, opacity: parseInt(sliders.bo.value, 10) / 100 });

    layers.forEach((layer, index) => {
      if (index === 0) {
        // 1層目はそのまま重ねずに描画（極めて鮮明な発色のベースになります）
        ctx.globalCompositeOperation = 'source-over';
      } else {
        // 2層目以降は、指定された重なり効果 (スクリーン/加算) でブレンド
        ctx.globalCompositeOperation = selectBlend.value;
      }
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
    btnDownload.textContent = '保存中...';

    setTimeout(() => {
      const origW = originalImage.width;
      const origH = originalImage.height;
      const scale = origW / previewWidth;

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = origW;
      outputCanvas.height = origH;
      const outCtx = outputCanvas.getContext('2d');

      // 高解像度用の一次描画から高精度ピクセル情報を抽出
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = origW;
      tempCanvas.height = origH;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(originalImage, 0, 0, origW, origH);
      const imgData = tempCtx.getImageData(0, 0, origW, origH);
      const data = imgData.data;

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

      const rData = ctxR.createImageData(origW, origH);
      const gData = ctxG.createImageData(origW, origH);
      const bData = ctxB.createImageData(origW, origH);

      const len = data.length;

      // 高解像度保存時も同様に透過＆元のアルファを保持
      for (let i = 0; i < len; i += 4) {
        const alpha = data[i+3];
        if (alpha > 0) {
          rData.data[i] = data[i];
          rData.data[i+3] = alpha;
          
          gData.data[i+1] = data[i+1];
          gData.data[i+3] = alpha;
          
          bData.data[i+2] = data[i+2];
          bData.data[i+3] = alpha;
        }
      }

      ctxR.putImageData(rData, 0, 0);
      ctxG.putImageData(gData, 0, 0);
      ctxB.putImageData(bData, 0, 0);

      // 高解像度保存時も同様にアルファ干渉を排除して合成
      outCtx.globalCompositeOperation = 'source-over';
      outCtx.clearRect(0, 0, origW, origH);

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

      hResLayers.forEach((layer, index) => {
        if (index === 0) {
          outCtx.globalCompositeOperation = 'source-over';
        } else {
          outCtx.globalCompositeOperation = selectBlend.value;
        }
        outCtx.globalAlpha = layer.opacity;
        outCtx.drawImage(hResChannels[layer.key], layer.x, layer.y);
      });

      // ★重要：最後に黒背景を下に敷く（destination-over）ことで、
      // 途中のアルファ計算を一切濁らせずに、完全な黒背景画像としてPNG化します。
      outCtx.globalAlpha = 1.0;
      outCtx.globalCompositeOperation = 'destination-over';
      outCtx.fillStyle = '#000000';
      outCtx.fillRect(0, 0, origW, origH);

      // ダウンロード保存処理
      const dataUrl = outputCanvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = 'rgb_shifted_artwork.png';
      link.href = dataUrl;
      link.click();

      btnDownload.disabled = false;
      btnDownload.textContent = '保存する';
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
    requestRender();
  });

  // 保存ボタン
  btnDownload.addEventListener('click', downloadHighResImage);
});
