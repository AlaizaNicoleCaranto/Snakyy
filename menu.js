let selectedDiff = 'medium';

function showScreen(id) {
    const screens = [
        'screen-main',
        'screen-difficulty',
        'screen-instructions',
        'screen-credits',
    ];
    screens.forEach(s => {
        document.getElementById(s).style.display = (s === id) ? 'block' : 'none';
    });
}

function selectDiff(level) {
    selectedDiff = level;
    ['easy', 'medium', 'hard'].forEach(d => {
        document.getElementById('btn-' + d).classList.remove('selected');
    });
    document.getElementById('btn-' + level).classList.add('selected');
}

function launchGame() {
    document.getElementById('mainMenu').style.display = 'none';
    document.getElementById('gameShell').style.display = 'block';
    startGame(selectedDiff);
}