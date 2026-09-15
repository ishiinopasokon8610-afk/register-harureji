// ==========================================
// touch-panel-menu-page-side-arrows-system.js
// ------------------------------------------
// このファイルも index.html を直接編集せず、他の追加機能ファイルと同じ
// 「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【今回の対応（3点）】
// ① メニュー画面を一番下までスクロールしたときに出てくる
// 　　「スクロールしてもメニューを進められます」という案内文と、
// 　　「次へ」「前へ」ボタンを非表示にした。
// ② その代わりに、画面の左右の端（縦方向の中央）に、常に表示される
// 　　「前のページ」「次のページ」の丸いボタンを新設した。
// ③ ついでに、これ以上先／前のページがない場合は、その矢印ボタンを
// 　　薄い表示にしてタップしても何も起きないようにした（押せるか
// 　　どうかが見た目で分かるように）。あわせて、タップした瞬間に
// 　　少し縮む・対応端末では短く振動する、実店舗のタッチパネルに
// 　　近い手応えも付けている。
//
// 【重要：前提にしていること・ご確認のお願い】
// 「スクロールしてもメニューを進められます」の案内文と「次へ」
// 「前へ」ボタンは、おそらく menu-genre-page-grid-system.js という
// ファイルで作られていると思われるが、このファイルの中身をこちらで
// 確認できていない。そのため、正確なclass名・関数名を指定するのでは
// なく、次のようなやり方で対応している。
//
//   ・案内文／ボタンを見つけて消す
//     「表示されている文字」（該当の案内文、「次へ」「前へ」）で
//     探して、そのボタン・案内文だけを display:none で隠す
//     （要素自体はDOM上に残しておく）。
//
//   ・新しい左右の矢印ボタンをタップしたときの動作
//     実際にページを切り替える処理の中身が分からないため、独自に
//     作り直すのではなく、非表示にした元の「次へ」「前へ」ボタンを
//     裏側でそのままクリックしたことにする（見た目だけ差し替えて、
//     機能は元のものをそのまま使う）方式にしている。非表示
//     （display:none）にした要素でも、JSからのクリック実行自体は
//     問題なく動作する。
//
//   ・「これ以上進めない」の判定
//     「次へ」「前へ」の文字を持つ要素が見つからない場合、または
//     見つかっても disabled 属性や class名に"disabled"を含む場合に
//     「これ以上進めない」と判断している。もし元の実装が、ボタン
//     自体は常に存在していて見た目の色だけを変えている（disabled
//     らしき印がついていない）場合は、この判定が効かず、実際には
//     次のページがなくても矢印が薄くならないことがある。
//
// 動作しない・案内文の実際の文言が違う、といった場合や、
// menu-genre-page-grid-system.js の中身を共有してもらえる場合は、
// そちらを確認したうえで、class名・関数名を直接指定するより確実な
// 方法に直せるので教えてほしい。
// ==========================================

(function () {
    'use strict';

    const HINT_TEXT_FRAGMENT = 'スクロールしてもメニューを進められ';
    const NEXT_LABEL_RE = /^[▶►→〉]?次へ[▶►→〉]?$/;
    const PREV_LABEL_RE = /^[◀◄←〈]?前へ[◀◄←〈]?$/;

    /* 表示テキストから、該当する要素の中でもっとも文字数が少ない
       （＝もっとも内側にある）要素を探す */
    function tpFindSmallestMatch(overlay, labelRe) {
        let best = null;
        overlay.querySelectorAll('*').forEach(el => {
            const compact = (el.textContent || '').replace(/\s+/g, '');
            if (!compact || compact.length > 12) return;
            if (!labelRe.test(compact)) return;
            if (!best || el.textContent.length < best.textContent.length) best = el;
        });
        return best;
    }

    // 見つけた要素から、クリック可能そうな祖先（button/a/onclick付き）を
    // 探す。見つからなければ、見つかった要素自身を返す。
    function tpFindClickableAncestor(el) {
        let target = el;
        for (let i = 0; i < 6 && target; i++) {
            if (target.tagName === 'BUTTON' || target.tagName === 'A' || target.hasAttribute('onclick')) {
                return target;
            }
            target = target.parentElement;
        }
        return el;
    }

    function tpIsDisabledLike(el) {
        if (!el) return true;
        if (el.disabled) return true;
        if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true;
        if (el.className && typeof el.className === 'string' && /disabled/i.test(el.className)) return true;
        return false;
    }

    // 「次へ」「前へ」のクリック可能要素を返す（見つからなければnull）
    function tpGetPageNavButton(overlay, labelRe) {
        const match = tpFindSmallestMatch(overlay, labelRe);
        if (!match) return null;
        return tpFindClickableAncestor(match);
    }

    /* =========================================================
       ① 元の案内文・次へ／前へボタンを非表示にする
       ========================================================= */
    function tpHideOriginalPageNavElements(overlay) {
        overlay.querySelectorAll('*').forEach(el => {
            if (el.children.length > 0) return;
            const text = (el.textContent || '').trim();
            if (!text) return;
            if (text.includes(HINT_TEXT_FRAGMENT) && text.length < 60) {
                el.style.display = 'none';
            }
        });

        [NEXT_LABEL_RE, PREV_LABEL_RE].forEach(re => {
            const btn = tpGetPageNavButton(overlay, re);
            if (btn) btn.style.display = 'none';
        });
    }

    /* =========================================================
       ② 左右の固定矢印ボタン
       ========================================================= */
    function tpInjectPageSideArrowsStyle() {
        if (document.getElementById('tp-page-side-arrows-style')) return;
        const style = document.createElement('style');
        style.id = 'tp-page-side-arrows-style';
        style.textContent = `
            #touch-panel-overlay .tp-page-side-arrow {
                position: fixed;
                top: 50%;
                transform: translateY(-50%);
                width: 56px;
                height: 56px;
                border-radius: 50%;
                border: none;
                background: rgba(0,0,0,0.35);
                color: #fff;
                font-size: 28px;
                line-height: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 60;
                padding: 0;
                transition: opacity 0.2s ease;
            }
            #touch-panel-overlay .tp-page-side-arrow-left { left: 10px; }
            #touch-panel-overlay .tp-page-side-arrow-right { right: 10px; }
            #touch-panel-overlay .tp-page-side-arrow.tp-page-side-arrow-disabled {
                opacity: 0.28;
            }
            #touch-panel-overlay .tp-page-side-arrow.tp-page-side-arrow-pressed {
                transform: translateY(-50%) scale(0.88);
            }
            /* メニュー画面以外（卓番選択・お会計確認など）では表示しない */
            #touch-panel-overlay:not(.tp-theme-menu) .tp-page-side-arrow {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
    }

    function tpHandleArrowTap(overlay, btnEl, labelRe) {
        btnEl.classList.add('tp-page-side-arrow-pressed');
        setTimeout(() => btnEl.classList.remove('tp-page-side-arrow-pressed'), 100);

        const target = tpGetPageNavButton(overlay, labelRe);
        if (target && !tpIsDisabledLike(target)) {
            target.click();
            if (navigator.vibrate) navigator.vibrate(15);
        }
        // これ以上進めない／戻れない場合は何もしない
        // （ボタンはすでに tpUpdateArrowDisabledState で薄く表示されている）
    }

    function tpCreatePageSideArrows(overlay) {
        if (overlay.querySelector('.tp-page-side-arrow-left')) return;

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'tp-page-side-arrow tp-page-side-arrow-left';
        prevBtn.setAttribute('aria-label', '前のページ');
        prevBtn.textContent = '‹';
        prevBtn.addEventListener('click', () => tpHandleArrowTap(overlay, prevBtn, PREV_LABEL_RE));

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'tp-page-side-arrow tp-page-side-arrow-right';
        nextBtn.setAttribute('aria-label', '次のページ');
        nextBtn.textContent = '›';
        nextBtn.addEventListener('click', () => tpHandleArrowTap(overlay, nextBtn, NEXT_LABEL_RE));

        overlay.appendChild(prevBtn);
        overlay.appendChild(nextBtn);
    }

    function tpUpdateArrowDisabledState(overlay) {
        const prevBtn = overlay.querySelector('.tp-page-side-arrow-left');
        const nextBtn = overlay.querySelector('.tp-page-side-arrow-right');
        if (prevBtn) {
            const target = tpGetPageNavButton(overlay, PREV_LABEL_RE);
            prevBtn.classList.toggle('tp-page-side-arrow-disabled', !target || tpIsDisabledLike(target));
        }
        if (nextBtn) {
            const target = tpGetPageNavButton(overlay, NEXT_LABEL_RE);
            nextBtn.classList.toggle('tp-page-side-arrow-disabled', !target || tpIsDisabledLike(target));
        }
    }

    /* =========================================================
       ③ まとめて面倒を見る（定期実行＋スクロール時にも即実行）
       ========================================================= */
    function tpPageNavTick() {
        const overlay = document.getElementById('touch-panel-overlay');
        if (!overlay) return;
        tpInjectPageSideArrowsStyle();
        tpCreatePageSideArrows(overlay);
        tpHideOriginalPageNavElements(overlay);
        tpUpdateArrowDisabledState(overlay);
    }

    setInterval(tpPageNavTick, 400);

    // スクロールした瞬間に案内文・ボタンが出る想定のため、スクロール時にも
    // 即座に確認する（連続スクロール中に何度も走らないよう間引く）
    let tpScrollScheduled = false;
    document.addEventListener('scroll', function () {
        if (tpScrollScheduled) return;
        tpScrollScheduled = true;
        setTimeout(function () {
            tpScrollScheduled = false;
            tpPageNavTick();
        }, 150);
    }, true);
})();
