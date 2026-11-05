// 저장된 테마를 그리기 전에 적용(서버 렌더 페이지가 잠깐 다른 색으로 깜빡이지 않게)
try { var t = localStorage.getItem('fc:theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
