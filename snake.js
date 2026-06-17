const canvas = document.getElementById('gameBoard');
const ctx = canvas.getContext('2d');
const foodImage = new Image();
foodImage.src = 'assets/food.png';

const gridSize = 25;
const cellSize = canvas.width / gridSize;
let speed = 100;

let snake = [
    { x: 12, y: 12 },
    { x: 11, y: 12 },
    { x: 10, y: 12 },
    { x: 9, y: 12 }
];
let direction = { x: 1, y: 0 };
let nextDirection = { x: 1, y: 0 };
let score = 0;
let level = 1;
let gameOver = false;
let foodLoaded = false;

// ===== FLOORS =====
// There is only ONE snake. It shares the same x/y position on every
// floor — switching floors does not move it on the grid, it just
// changes which walls and which food currently apply to it.

const totalFloors = 4;
let currentFloor = 0;

// floorWalls[floorIndex] = a Set of "x,y" strings that are blocked on that floor
let floorWalls = [];

// floorFoods[floorIndex] = that floor's current food position { x, y }
let floorFoods = [];

// How cramped each floor is. Higher = more wall blocks = less room.
// Floor index 1 (shown to the player as "Floor 2") is the tightest,
// per design — it is NOT a straight line with floor number.
const floorDensity = [25, 20, 13, 16];

// Tracks which floors have already had their maze generated.
// Floors are generated lazily — the first time the snake steps onto
// them — rather than all at once at game start, so the safe zone can
// be built around wherever the snake actually is (and which way it's
// facing) at that moment instead of a generic starting box.
let floorGenerated = [];

// Builds a safe zone around a given position, including extra room
// in front of the snake based on its current facing direction.
// This guarantees a fresh floor never drops a wall directly on the
// snake's head or immediately in its path.
function buildSafeZone(headX, headY, dir) {
    const zone = new Set();

    // Clear a generous box around the snake's current position
    const radius = 3;
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            zone.add(`${headX + dx},${headY + dy}`);
        }
    }

    // Extend extra clearance further along the direction the snake
    // is currently facing, so it never walks into a wall the instant
    // it switches floors
    const lookahead = 5;
    for (let i = 1; i <= lookahead; i++) {
        const x = headX + dir.x * i;
        const y = headY + dir.y * i;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                zone.add(`${x + dx},${y + dy}`);
            }
        }
    }

    return zone;
}

// Builds one random wall layout for a floor. Walls are made of short
// 1xN or Nx1 "blocks" (matching the segmented look in-game) scattered
// across the grid, rather than one predictable ring shape.
//
// Blocks require a 2-cell buffer from any existing wall cell before
// they're allowed to be placed. This keeps individual blocks visibly
// separated as distinct, spread-out obstacles instead of bunching up
// (which is what made things feel congested, especially in corners
// where leftover space after the safe zone was tightest).
function generateRandomWalls(blockCount, safeZone) {
    const walls = new Set();
    let placed = 0;
    let attempts = 0;
    const maxAttempts = blockCount * 150;
    const buffer = 2;

    // True if any cell within `buffer` distance is already a wall
    function touchesExistingWall(x, y) {
        for (let dx = -buffer; dx <= buffer; dx++) {
            for (let dy = -buffer; dy <= buffer; dy++) {
                if (walls.has(`${x + dx},${y + dy}`)) return true;
            }
        }
        return false;
    }

    while (placed < blockCount && attempts < maxAttempts) {
        attempts++;

        const horizontal = Math.random() < 0.5;
        const length = 2 + Math.floor(Math.random() * 4); // blocks of 2-5 cells
        const startX = Math.floor(Math.random() * gridSize);
        const startY = Math.floor(Math.random() * gridSize);

        const cells = [];
        let fits = true;

        for (let i = 0; i < length; i++) {
            const x = horizontal ? startX + i : startX;
            const y = horizontal ? startY : startY + i;

            if (x < 1 || x >= gridSize - 1 || y < 1 || y >= gridSize - 1) {
                fits = false;
                break;
            }
            const key = `${x},${y}`;
            if (safeZone.has(key) || touchesExistingWall(x, y)) {
                fits = false;
                break;
            }
            cells.push(key);
        }

        if (fits) {
            cells.forEach(key => walls.add(key));
            placed++;
        }
    }

    return walls;
}

// Flood-fills from a starting open cell to count how many open cells
// are reachable. Used to make sure a random layout never seals off
// part of the board into an unreachable pocket.
function countReachableOpenCells(walls) {
    let start = null;
    for (let x = 0; x < gridSize && !start; x++) {
        for (let y = 0; y < gridSize; y++) {
            if (!walls.has(`${x},${y}`)) {
                start = { x, y };
                break;
            }
        }
    }
    if (!start) return 0;

    const visited = new Set([`${start.x},${start.y}`]);
    const queue = [start];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    while (queue.length) {
        const cur = queue.pop();
        for (const [dx, dy] of dirs) {
            const nx = cur.x + dx;
            const ny = cur.y + dy;
            if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
            const key = `${nx},${ny}`;
            if (walls.has(key) || visited.has(key)) continue;
            visited.add(key);
            queue.push({ x: nx, y: ny });
        }
    }

    return visited.size;
}

// Builds the wall layout for one floor: keeps generating random
// layouts until one leaves every open cell reachable from every
// other open cell (no sealed-off pockets the snake could get stuck
// behind, and no food could spawn somewhere unreachable). Because
// generateRandomWalls() enforces a 1-cell buffer between blocks,
// walls naturally stay as separate obstacles with open paths between
// and around them, rather than fusing into one solid mass with a
// single squeeze-through.
//
// headX/headY/dir describe where the snake is and which way it's
// facing AT THE MOMENT this floor is generated, so the generator can
// keep that exact area clear — this is what stops walls from ever
// spawning right in front of the snake's face.
function buildFloorWalls(floorIndex, headX, headY, dir) {
    // if (floorIndex === 0) {
    //     return new Set(); // ground floor: always fully open
    // }

    const blockCount = floorDensity[floorIndex] || 20;
    const totalOpenTarget = (gridSize * gridSize);
    const safeZone = buildSafeZone(headX, headY, dir);

    let bestAttempt = new Set();
    let bestReachable = -1;

    for (let attempt = 0; attempt < 25; attempt++) {
        const candidate = generateRandomWalls(blockCount, safeZone);
        const reachable = countReachableOpenCells(candidate);
        const openCells = totalOpenTarget - candidate.size;

        // Fully connected if every open cell is reachable from the start
        if (reachable === openCells) {
            return candidate;
        }
        if (reachable > bestReachable) {
            bestReachable = reachable;
            bestAttempt = candidate;
        }
    }

    // Fallback: if 25 attempts never produced a fully-connected layout
    // (rare), use the best-connected one found
    return bestAttempt;
}

// Resets floor state so every floor will be (re)generated the next
// time the snake steps onto it. Called at game start and on restart.
function resetFloors() {
    floorWalls = [];
    floorGenerated = [];
    for (let f = 0; f < totalFloors; f++) {
        floorWalls.push(new Set());
        floorGenerated.push(false);
    }
}

// Generates a floor's maze the first time the snake visits it, using
// the snake's current head position and facing direction as the safe
// zone. Does nothing if that floor was already generated this game.
function ensureFloorGenerated(floorIndex) {
    if (floorGenerated[floorIndex]) return;

    const head = snake[0];
    floorWalls[floorIndex] = buildFloorWalls(floorIndex, head.x, head.y, direction);
    floorGenerated[floorIndex] = true;
}


// New variables for special food
let specialFood = null;
let specialFoodTimer = null;
let specialFoodActive = false;
let animationFrame = 0;
let pulseDirection = 1;
// Chance to spawn special food per floor (higher for lower floors)
// Index 0 = Floor 1 (ground), index 1 = Floor 2, etc.
const specialFoodChanceByFloor = [0.75, 0.50, 0.15, 0.08];

// Wait for food image to load
foodImage.onload = () => {
    foodLoaded = true;
    if (!gameOver) {
        drawBoard();
        drawSnake();
        drawFood();
        drawScore();
    }
};

function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#07101f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += cellSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += cellSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    drawWalls();
}

function drawWalls() {
    const walls = floorWalls[currentFloor];
    if (!walls || walls.size === 0) return;

    ctx.fillStyle = 'rgba(124, 58, 237, 0.5)';
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.8)';
    ctx.lineWidth = 1;

    walls.forEach(key => {
        const [x, y] = key.split(',').map(Number);
        ctx.fillRect(x * cellSize, y * cellSize, cellSize - 1, cellSize - 1);
        ctx.strokeRect(x * cellSize + 0.5, y * cellSize + 0.5, cellSize - 2, cellSize - 2);
    });
}

function drawSnake() {
    snake.forEach((segment, index) => {
        const gradient = ctx.createLinearGradient(
            segment.x * cellSize, 
            segment.y * cellSize,
            segment.x * cellSize + cellSize, 
            segment.y * cellSize + cellSize
        );
        
        if (index === 0) {
            gradient.addColorStop(0, '#22d3ee');
            gradient.addColorStop(1, '#06b6d4');
            ctx.fillStyle = gradient;
        } else {
            gradient.addColorStop(0, '#7dd3fc');
            gradient.addColorStop(1, '#38bdf8');
            ctx.fillStyle = gradient;
        }
        
        ctx.fillRect(segment.x * cellSize, segment.y * cellSize, cellSize - 1, cellSize - 1);
        
        if (index === 0) {
            ctx.fillStyle = '#ffffff';
            const eyeSize = cellSize * 0.2;
            const eyeOffset = cellSize * 0.25;
            
            if (direction.x === 1) {
                ctx.fillRect(segment.x * cellSize + cellSize - eyeOffset, segment.y * cellSize + eyeOffset, eyeSize, eyeSize);
                ctx.fillRect(segment.x * cellSize + cellSize - eyeOffset, segment.y * cellSize + cellSize - eyeOffset - eyeSize, eyeSize, eyeSize);
            } else if (direction.x === -1) {
                ctx.fillRect(segment.x * cellSize + eyeOffset - eyeSize, segment.y * cellSize + eyeOffset, eyeSize, eyeSize);
                ctx.fillRect(segment.x * cellSize + eyeOffset - eyeSize, segment.y * cellSize + cellSize - eyeOffset - eyeSize, eyeSize, eyeSize);
            } else if (direction.y === -1) {
                ctx.fillRect(segment.x * cellSize + eyeOffset, segment.y * cellSize + eyeOffset - eyeSize, eyeSize, eyeSize);
                ctx.fillRect(segment.x * cellSize + cellSize - eyeOffset - eyeSize, segment.y * cellSize + eyeOffset - eyeSize, eyeSize, eyeSize);
            } else {
                ctx.fillRect(segment.x * cellSize + eyeOffset, segment.y * cellSize + cellSize - eyeOffset, eyeSize, eyeSize);
                ctx.fillRect(segment.x * cellSize + cellSize - eyeOffset - eyeSize, segment.y * cellSize + cellSize - eyeOffset, eyeSize, eyeSize);
            }
        }
    });
}

function drawFood() {
    // Animate regular food (pulsing effect)
    animationFrame += 0.05 * pulseDirection;
    if (animationFrame >= 1) pulseDirection = -1;
    if (animationFrame <= 0) pulseDirection = 1;
    
    const scale = 0.8 + (Math.sin(Date.now() * 0.008) * 0.1);
    const food = floorFoods[currentFloor];

    if (food) {
        if (foodLoaded && foodImage.complete) {
            const size = cellSize - (4 * scale);
            const offset = (cellSize - size) / 2;

            ctx.save();
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#f97316';
            ctx.drawImage(
                foodImage,
                food.x * cellSize + offset,
                food.y * cellSize + offset,
                size,
                size
            );
            ctx.restore();
        } else {
            ctx.fillStyle = '#f97316';
            ctx.fillRect(food.x * cellSize + 2, food.y * cellSize + 2, cellSize - 4, cellSize - 4);
        }
    }
    
    // Draw special food if active
    if (specialFoodActive && specialFood) {
        const pulseScale = 0.8 + (Math.sin(Date.now() * 0.012) * 0.15);
        const size = cellSize - 2;
        const offset = (cellSize - size) / 2;
        
        // Draw glowing effect
        ctx.save();
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#fbbf24';
        
        // Draw gold border
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.strokeRect(
            specialFood.x * cellSize + offset - 2,
            specialFood.y * cellSize + offset - 2,
            size + 4,
            size + 4
        );
        
        if (foodLoaded && foodImage.complete) {
            // Draw larger food with gold tint
            ctx.drawImage(
                foodImage,
                specialFood.x * cellSize + offset - 2,
                specialFood.y * cellSize + offset - 2,
                size + 4,
                size + 4
            );
            
            // Add gold overlay
            ctx.fillStyle = 'rgba(251, 191, 36, 0.3)';
            ctx.fillRect(
                specialFood.x * cellSize + offset - 2,
                specialFood.y * cellSize + offset - 2,
                size + 4,
                size + 4
            );
        } else {
            ctx.fillStyle = '#fbbf24';
            ctx.fillRect(
                specialFood.x * cellSize + offset - 2,
                specialFood.y * cellSize + offset - 2,
                size + 4,
                size + 4
            );
        }
        
        // Draw stars around special food
        ctx.fillStyle = '#fbbf24';
        for (let i = 0; i < 4; i++) {
            const angle = Date.now() * 0.005 + (i * Math.PI * 2 / 4);
            const starX = specialFood.x * cellSize + cellSize / 2 + Math.cos(angle) * cellSize * 0.7;
            const starY = specialFood.y * cellSize + cellSize / 2 + Math.sin(angle) * cellSize * 0.7;
            ctx.beginPath();
            ctx.arc(starX, starY, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore();
        
        // Draw "2X" text on special food
        ctx.font = `bold ${Math.floor(cellSize * 0.35)}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 4;
        ctx.shadowColor = 'black';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('2X', specialFood.x * cellSize + cellSize / 2, specialFood.y * cellSize + cellSize / 2);
        ctx.shadowBlur = 0;
    }
}

function drawScore() {
    document.getElementById('score').textContent = score;
    document.getElementById('level').textContent = level;
}

function spawnSpecialFood() {
    if (specialFoodTimer) clearTimeout(specialFoodTimer);
    if (specialFoodActive) return;
    
    // Chance to spawn special food after each regular food eaten varies by floor
    const chance = specialFoodChanceByFloor[currentFloor] ?? 0.15;
    if (Math.random() < chance && !gameOver) {
        const occupied = new Set(snake.map(part => `${part.x},${part.y}`));
        const currentFood = floorFoods[currentFloor];
        if (currentFood) {
            occupied.add(`${currentFood.x},${currentFood.y}`);
        }
        const walls = floorWalls[currentFloor] || new Set();
        
        let position;
        let attempts = 0;
        
        do {
            position = {
                x: Math.floor(Math.random() * gridSize),
                y: Math.floor(Math.random() * gridSize)
            };
            attempts++;
            if (attempts > 500) return;
        } while (occupied.has(`${position.x},${position.y}`) || walls.has(`${position.x},${position.y}`));
        
        specialFood = position;
        specialFoodActive = true;
        
        // Special food disappears after 5 seconds
        specialFoodTimer = setTimeout(() => {
            specialFoodActive = false;
            specialFood = null;
            drawBoard();
            drawSnake();
            drawFood();
            drawScore();
        }, 5000);
    }
}

function placeFood(floorIndex = currentFloor) {
    // Only avoid the snake's body when placing food on the floor the
    // snake is currently on. Other floors just need to avoid their walls.
    const occupied = new Set();
    if (floorIndex === currentFloor) {
        snake.forEach(part => occupied.add(`${part.x},${part.y}`));
        if (specialFoodActive && specialFood) {
            occupied.add(`${specialFood.x},${specialFood.y}`);
        }
    }

    const walls = floorWalls[floorIndex] || new Set();

    let position;
    let attempts = 0;
    const maxAttempts = 1000;

    do {
        position = {
            x: Math.floor(Math.random() * gridSize),
            y: Math.floor(Math.random() * gridSize)
        };
        attempts++;
        if (attempts > maxAttempts) {
            // No free space left on this floor — extremely rare, just skip
            return;
        }
    } while (
        walls.has(`${position.x},${position.y}`) ||
        occupied.has(`${position.x},${position.y}`)
    );

    floorFoods[floorIndex] = position;

    // Special food only ever spawns relative to the floor the
    // snake is actually standing on
    if (floorIndex === currentFloor) {
        spawnSpecialFood();
    }
}

// Makes sure a floor has its maze built and food placed on it.
// Called once per floor, the first time the snake ever lands there.
function ensureFloorReady(floorIndex) {
    const alreadyGenerated = floorGenerated[floorIndex];
    ensureFloorGenerated(floorIndex);
    if (!alreadyGenerated) {
        placeFood(floorIndex);
    }
}

function isCollision(head) {
    if (head.x < 0 || head.x >= gridSize || head.y < 0 || head.y >= gridSize) {
        return true;
    }
    if (floorWalls[currentFloor] && floorWalls[currentFloor].has(`${head.x},${head.y}`)) {
        return true;
    }
    return snake.some(segment => segment.x === head.x && segment.y === head.y);
}

function update() {
    if (gameOver) {
        return;
    }

    direction = nextDirection;
    const newHead = {
        x: snake[0].x + direction.x,
        y: snake[0].y + direction.y
    };

    if (isCollision(newHead)) {
        gameOver = true;
        if (specialFoodTimer) clearTimeout(specialFoodTimer);
        drawBoard();
        drawSnake();
        drawFood();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = 'bold 32px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Game Over', canvas.width / 2, canvas.height / 2 - 20);
        ctx.font = '18px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText('Press Space to play again', canvas.width / 2, canvas.height / 2 + 20);
        return;
    }

    snake.unshift(newHead);
    
    let ateFood = false;
    let pointsEarned = 0;
    
    // Check for special food first
    if (specialFoodActive && specialFood && newHead.x === specialFood.x && newHead.y === specialFood.y) {
        ateFood = true;
        pointsEarned = 20; // Double points!
        score += pointsEarned;
        
        // Visual feedback for double points
        ctx.fillStyle = '#fbbf24';
        ctx.font = `bold ${Math.floor(cellSize * 0.5)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.shadowBlur = 0;
        
        specialFoodActive = false;
        if (specialFoodTimer) clearTimeout(specialFoodTimer);
        specialFood = null;
    }
    // Then check for regular food
    else if (floorFoods[currentFloor] && newHead.x === floorFoods[currentFloor].x && newHead.y === floorFoods[currentFloor].y) {
        ateFood = true;
        pointsEarned = 10;
        score += pointsEarned;
    }
    
    if (ateFood) {
        if (score % 50 === 0 && score > 0) {
            level += 1;
        }
        placeFood();
        drawScore();
        
        // Show floating text for points
        drawBoard();
        drawSnake();
        drawFood();
        
        ctx.fillStyle = pointsEarned === 20 ? '#fbbf24' : '#22d3ee';
        ctx.font = `bold ${Math.floor(cellSize * 0.4)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.shadowBlur = 0;
        ctx.fillText(`+${pointsEarned}`, newHead.x * cellSize + cellSize / 2, newHead.y * cellSize - 5);
        
        setTimeout(() => {
            if (!gameOver) {
                drawBoard();
                drawSnake();
                drawFood();
                drawScore();
            }
        }, 200);
    } else {
        snake.pop();
    }

    drawBoard();
    drawSnake();
    drawFood();
    drawScore();
}

function restartGame() {
    snake = [
        { x: 12, y: 12 },
        { x: 11, y: 12 },
        { x: 10, y: 12 },
        { x: 9, y: 12 }
    ];
    direction = { x: 1, y: 0 };
    nextDirection = { x: 1, y: 0 };
    score = 0;
    level = 1;
    gameOver = false;
    specialFoodActive = false;
    specialFood = null;
    currentFloor = 0;
    if (specialFoodTimer) clearTimeout(specialFoodTimer);
    resetFloors();
    ensureFloorReady(currentFloor);
    drawBoard();
    drawSnake();
    drawFood();
    drawScore();
    drawFloorIndicator();
}

// Moves the snake up or down a floor. The x/y position stays the
// same — only the active wall layout and food change.
function changeFloor(delta) {
    if (gameOver) return;

    const targetFloor = currentFloor + delta;
    if (targetFloor < 0 || targetFloor >= totalFloors) {
        return; // already at the top or bottom floor
    }

    // Generate the destination floor now, if this is the first time
    // we're visiting it. Because this happens at the exact moment of
    // switching, the maze's safe zone is built around exactly where
    // the snake is and which way it's facing right now — so a wall
    // can never spawn on top of it or directly in its path.
    ensureFloorReady(targetFloor);

    currentFloor = targetFloor;

    // Cancel any special food countdown from the previous floor
    specialFoodActive = false;
    specialFood = null;
    if (specialFoodTimer) clearTimeout(specialFoodTimer);

    drawBoard();
    drawSnake();
    drawFood();
    drawFloorIndicator();
}

function drawFloorIndicator() {
    const el = document.getElementById('floor');
    if (el) el.textContent = currentFloor + 1;
}

window.addEventListener('keydown', (event) => {
    if (gameOver) {
        if (event.key === ' ' || event.key === 'Space') {
            event.preventDefault();
            restartGame();
        }
        return;
    }

    const key = event.key;

    // Floor switching: Space = up a floor, Ctrl = down a floor
    if (key === ' ' || key === 'Space') {
        event.preventDefault();
        changeFloor(1);
        return;
    }
    if (key === 'Control') {
        event.preventDefault();
        changeFloor(-1);
        return;
    }

    if (key === 'ArrowUp' && direction.y === 0) {
        nextDirection = { x: 0, y: -1 };
    } else if (key === 'ArrowDown' && direction.y === 0) {
        nextDirection = { x: 0, y: 1 };
    } else if (key === 'ArrowLeft' && direction.x === 0) {
        nextDirection = { x: -1, y: 0 };
    } else if (key === 'ArrowRight' && direction.x === 0) {
        nextDirection = { x: 1, y: 0 };
    }
});

// Difficulty speeds 
const difficultySettings = {
    easy:   150,
    medium: 100,
    hard:    60
};

// called by the menu's Start button
function startGame(difficulty) {
    // 1. Set speed based on chosen difficulty
    speed = difficultySettings[difficulty] || 100;

    // 2. Hide the menu, show the game
    document.getElementById('mainMenu').style.display = 'none';
    document.getElementById('gameShell').style.display = 'block';

    // 3. Reset floor state, then generate only the floor we're
    //    starting on. The rest generate lazily the first time the
    //    snake actually steps onto them.
    currentFloor = 0;
    resetFloors();
    ensureFloorReady(currentFloor);

    // 4. Draw the initial board and begin the loop
    drawBoard();
    drawSnake();
    drawScore();
    drawFloorIndicator();
    if (foodLoaded && foodImage.complete) {
        drawFood();
    }
    setInterval(update, speed);
}