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

/**
 * Converts an arithmetic expression string into a sequence of lexical tokens.
 *
 * Recognizes numeric literals (including decimals) as `NUMBER`, identifiers as `VARIABLE`,
 * operators `+ - * / ^` as `OPERATOR`, and parentheses as `LPAREN` / `RPAREN`. Whitespace is ignored;
 * an `EOF` token is appended at the end. Throws an `Error` on any unrecognized character.
 *
 * @param expr - The arithmetic expression to tokenize
 * @returns An array of tokens representing the input expression, terminated by an `EOF` token
 */
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

/**
 * Evaluate an AST representing an arithmetic expression using the provided variable bindings.
 *
 * @param node - The AST node to evaluate (number, variable, or binary operation).
 * @param variables - Map of variable names to Variable objects; a missing entry or a Variable with `value === null` is treated as unresolved.
 * @returns The numeric result of evaluating `node`, or `null` if evaluation cannot be completed due to unresolved variables or invalid operations (for example, division by zero).
 */
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
 * Determine whether an arithmetic expression string is syntactically valid.
 *
 * @param expr - The expression to validate
 * @returns `true` if the expression is syntactically valid, `false` otherwise.
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
 * Evaluate an arithmetic expression using the provided variable bindings.
 *
 * If `expr` is a number, it is returned directly; otherwise the expression is tokenized,
 * parsed, and evaluated. Evaluation returns `null` when a referenced variable is missing
 * or has a `null` value, when division by zero occurs, or when tokenization/parsing fails.
 *
 * @param expr - The expression to evaluate, either a numeric literal or an expression string.
 * @param variables - Map of variable names to `Variable` values used during evaluation.
 * @returns The numeric result of the evaluation, or `null` on unresolved variables, division by zero, or parse/evaluation errors.
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
 * Extracts variable names present in an expression.
 *
 * @param expr - The expression to analyze, either a string or a numeric literal. If a number is provided, no variables are present.
 * @returns An array of variable names found in the expression; duplicates are preserved. Returns an empty array if `expr` is a number or if tokenization fails.
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