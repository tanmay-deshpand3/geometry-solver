// Expression Parser & Evaluator
// Recursive Descent Parser with support for:
// - Parentheses ()
// - Operators: + - * / ^
// - Precedence: ^ > * / > + -
// - Variables (referenced by name)

import type { Variable } from './types';

// ============ TOKENIZER ============
type TokenType = 'NUMBER' | 'VARIABLE' | 'OPERATOR' | 'LPAREN' | 'RPAREN' | 'EOF';

interface Token {
    type: TokenType;
    value: string;
}

function tokenize(expr: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < expr.length) {
        const char = expr[i];

        // Skip whitespace
        if (/\s/.test(char)) {
            i++;
            continue;
        }

        // Numbers (including decimals)
        if (/[0-9.]/.test(char)) {
            let num = '';
            while (i < expr.length && /[0-9.]/.test(expr[i])) {
                num += expr[i];
                i++;
            }
            tokens.push({ type: 'NUMBER', value: num });
            continue;
        }

        // Variables (letters and underscores)
        if (/[a-zA-Z_]/.test(char)) {
            let name = '';
            while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
                name += expr[i];
                i++;
            }
            tokens.push({ type: 'VARIABLE', value: name });
            continue;
        }

        // Operators
        if (['+', '-', '*', '/', '^'].includes(char)) {
            tokens.push({ type: 'OPERATOR', value: char });
            i++;
            continue;
        }

        // Parentheses
        if (char === '(') {
            tokens.push({ type: 'LPAREN', value: '(' });
            i++;
            continue;
        }
        if (char === ')') {
            tokens.push({ type: 'RPAREN', value: ')' });
            i++;
            continue;
        }

        // Unknown character - syntax error
        throw new Error(`Unexpected character: ${char}`);
    }

    tokens.push({ type: 'EOF', value: '' });
    return tokens;
}

// ============ PARSER (AST) ============
type ASTNode =
    | { type: 'number'; value: number }
    | { type: 'variable'; name: string }
    | { type: 'binary'; op: string; left: ASTNode; right: ASTNode };

class Parser {
    private tokens: Token[];
    private pos = 0;

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    private current(): Token {
        return this.tokens[this.pos];
    }

    private consume(type: TokenType): Token {
        const token = this.current();
        if (token.type !== type) {
            throw new Error(`Expected ${type}, got ${token.type}`);
        }
        this.pos++;
        return token;
    }

    private peek(): Token {
        return this.tokens[this.pos];
    }

    // Grammar:
    // expr      = addExpr
    // addExpr   = mulExpr (('+' | '-') mulExpr)*
    // mulExpr   = powExpr (('*' | '/') powExpr)*
    // powExpr   = primary ('^' powExpr)?  (right-associative)
    // primary   = NUMBER | VARIABLE | '(' expr ')'

    parse(): ASTNode {
        const node = this.parseAddExpr();
        if (this.current().type !== 'EOF') {
            throw new Error('Unexpected token after expression');
        }
        return node;
    }

    private parseAddExpr(): ASTNode {
        let left = this.parseMulExpr();
        while (this.peek().type === 'OPERATOR' && ['+', '-'].includes(this.peek().value)) {
            const op = this.consume('OPERATOR').value;
            const right = this.parseMulExpr();
            left = { type: 'binary', op, left, right };
        }
        return left;
    }

    private parseMulExpr(): ASTNode {
        let left = this.parsePowExpr();
        while (this.peek().type === 'OPERATOR' && ['*', '/'].includes(this.peek().value)) {
            const op = this.consume('OPERATOR').value;
            const right = this.parsePowExpr();
            left = { type: 'binary', op, left, right };
        }
        return left;
    }

    private parsePowExpr(): ASTNode {
        const base = this.parsePrimary();
        if (this.peek().type === 'OPERATOR' && this.peek().value === '^') {
            this.consume('OPERATOR');
            const exp = this.parsePowExpr(); // Right-associative
            return { type: 'binary', op: '^', left: base, right: exp };
        }
        return base;
    }

    private parsePrimary(): ASTNode {
        const token = this.current();

        if (token.type === 'NUMBER') {
            this.consume('NUMBER');
            return { type: 'number', value: parseFloat(token.value) };
        }

        if (token.type === 'VARIABLE') {
            this.consume('VARIABLE');
            return { type: 'variable', name: token.value };
        }

        if (token.type === 'LPAREN') {
            this.consume('LPAREN');
            const expr = this.parseAddExpr();
            this.consume('RPAREN');
            return expr;
        }

        throw new Error(`Unexpected token: ${token.type}`);
    }
}

// ============ EVALUATOR ============
function evaluateAST(node: ASTNode, variables: Map<string, Variable>): number | null {
    if (node.type === 'number') {
        return node.value;
    }

    if (node.type === 'variable') {
        const v = variables.get(node.name);
        if (!v || v.value === null) {
            return null; // Variable not resolved
        }
        return v.value;
    }

    if (node.type === 'binary') {
        const left = evaluateAST(node.left, variables);
        const right = evaluateAST(node.right, variables);
        if (left === null || right === null) {
            return null;
        }
        switch (node.op) {
            case '+': return left + right;
            case '-': return left - right;
            case '*': return left * right;
            case '/': return right !== 0 ? left / right : null;
            case '^': return Math.pow(left, right);
            default: return null;
        }
    }

    return null;
}

// ============ PUBLIC API ============

/**
 * Parses and validates an expression string.
 * Returns true if valid, false otherwise.
 */
export function validateExpression(expr: string): boolean {
    try {
        const tokens = tokenize(expr);
        new Parser(tokens).parse();
        return true;
    } catch {
        return false;
    }
}

/**
 * Evaluates an expression given a map of variables.
 * Returns the numeric result, or null if any referenced variable is unresolved.
 */
export function evaluateExpression(expr: string | number, variables: Map<string, Variable>): number | null {
    if (typeof expr === 'number') {
        return expr;
    }
    try {
        const tokens = tokenize(expr);
        const ast = new Parser(tokens).parse();
        return evaluateAST(ast, variables);
    } catch {
        return null;
    }
}

/**
 * Extracts variable names from an expression.
 */
export function extractVariableNames(expr: string | number): string[] {
    if (typeof expr === 'number') {
        return [];
    }
    try {
        const tokens = tokenize(expr);
        return tokens
            .filter(t => t.type === 'VARIABLE')
            .map(t => t.value);
    } catch {
        return [];
    }
}
