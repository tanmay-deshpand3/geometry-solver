# Geometry Solver

A powerful web-based geometry solving tool that enables users to construct, manipulate, and solve complex geometric constraints in real-time. Built with performance and precision in mind, this application serves as a modern interactive playground for Euclidean geometry.

## Key Features

*   **Interactive Canvas**: Real-time rendering and manipulation of geometric entities using [Paper.js](http://paperjs.org/).
*   **Constraint Solving**: Define relationships between points, lines, and circles (e.g., Distance, Angle, Incidence). The system automatically solves for undetermined variables to satisfy these constraints.
*   **Dynamic Measurements**: Real-time measurement of lengths, angles, and areas, including complex paths involving circular arcs.
*   **Advanced Tools**:
    *   **Smart Snapping**: Intelligent point and intersection detection.
    *   **Construction Tools**: Unrestricted point placement, lines, circles (radius, circumference, 3-point).
    *   **Variable Management**: HUD for precise numerical input and variable tracking.
*   **State Management**: Robust undo/redo capabilities and history tracking.

## Tech Stack

This project demonstrates expertise in modern frontend engineering and mathematical software design:

*   **Core**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) for type-safe, component-based architecture.
*   **Build System**: [Vite](https://vitejs.dev/) for lightning-fast HMR and optimized production builds.
*   **Graphics Engine**: [Paper.js](http://paperjs.org/) for high-performance 2D vector graphics rendering.
*   **Styling**: Custom CSS variables for a maintainable, theme-aware design system.
*   **Quality Assurance**: ESLint configuration for strict code quality and consistent formatting.

## Architecture & Design

*   **Modular State Management**: Custom hooks and state reducers efficiently manage the complex dependency graph of geometric entities.
*   **Mathematical Solver**: Implements numerical methods to iteratively solve systems of geometric constraints.
*   **Separation of Concerns**: Pure presentation components separated from the heavy lifting of geometric calculations and solver logic.

## Getting Started

### Prerequisites
*   Node.js (v18 or higher)
*   npm or yarn

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/desh/geometry-solver.git
    cd geometry-solver
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Start the development server:
    ```bash
    npm run dev
    ```

4.  Open `http://localhost:5173` in your browser.

## Contributing


Contributions are welcome! Please feel free to submit a Pull Request.

## Inspiration

This project was inspired by the challenging geometry problems often found in YouTube thumbnails. Seeing so many videos featuring intricate geometric puzzles highlighted the need for a tool that can interactively model and solve them. This application exists to bridge that gap, allowing users to verify solutions and explore these problems dynamically.

---
*Built to demonstrate robust software engineering practices and passion for algorithmic challenges.*
