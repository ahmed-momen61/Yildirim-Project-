import sys
import os
import hashlib
import tempfile
import subprocess
import base64
import ast
import random
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# ANSI escape codes for styling
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
MAGENTA = "\033[35m"
RED = "\033[31m"
RESET = "\033[0m"

app = FastAPI(title="LLVM/AST Mutator Backend")

def compile_to_llvm_ir(python_code: str) -> str:
    with tempfile.NamedTemporaryFile(suffix='.py', delete=False) as f:
        f.write(python_code.encode())
        cython_file = f.name
    c_file = cython_file.replace('.py', '.c')
    ir_file = cython_file.replace('.py', '.ll')
    subprocess.run(['cython', '-3', cython_file, '-o', c_file], check=True)
    subprocess.run(['clang', '-S', '-emit-llvm', '-O1', c_file, '-o', ir_file], check=True)
    with open(ir_file) as f:
        ir = f.read()
    os.remove(cython_file)
    os.remove(c_file)
    os.remove(ir_file)
    return ir

def mutate_llvm_ir(ir_code: str, seed: int) -> str:
    rng = random.Random(seed)
    lines = ir_code.split('\n')
    mutated = []
    for line in lines:
        if line.startswith('  %') and '=' in line:
            if rng.random() < 0.15:
                opaque_var = f"%op_{rng.randint(1000,9999)}"
                mutated.append(f"  {opaque_var} = add i32 0, 0  ; opaque pred")
        mutated.append(line)
    return '\n'.join(mutated)

def compile_ir_to_elf(ir_code: str) -> bytes:
    with tempfile.NamedTemporaryFile(suffix='.ll', delete=False) as f:
        f.write(ir_code.encode())
        ir_file = f.name
    obj_file = ir_file.replace('.ll', '.o')
    subprocess.run(['clang', '-c', ir_file, '-o', obj_file], check=True)
    with open(obj_file, 'rb') as f:
        elf_bytes = f.read()
    os.remove(ir_file)
    os.remove(obj_file)
    return elf_bytes

class ASTObfuscator(ast.NodeTransformer):
    def __init__(self, seed: int):
        self.rng = random.Random(seed)
        self.name_map = {}
    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Store) or isinstance(node.ctx, ast.Load):
            if not node.id.startswith('__') and node.id not in dir(__builtins__):
                if node.id not in self.name_map:
                    self.name_map[node.id] = f"_v{self.rng.randint(10000, 99999)}"
                node.id = self.name_map[node.id]
        return self.generic_visit(node)
    def visit_FunctionDef(self, node):
        if not node.name.startswith('__'):
            if node.name not in self.name_map:
                self.name_map[node.name] = f"_f{self.rng.randint(10000, 99999)}"
            node.name = self.name_map[node.name]
        if self.rng.random() < 0.5:
            opaque_if = ast.If(
                test=ast.Compare(
                    left=ast.BinOp(left=ast.Constant(value=self.rng.randint(1,10)), op=ast.Mult(), right=ast.Constant(value=self.rng.randint(1,10))),
                    ops=[ast.Eq()],
                    comparators=[ast.Constant(value=-1)]
                ),
                body=[ast.Pass()],
                orelse=[]
            )
            ast.copy_location(opaque_if, node)
            node.body.insert(0, opaque_if)
        return self.generic_visit(node)

def mutate_ast_fallback(python_code: str, seed: int) -> str:
    import astor
    tree = ast.parse(python_code)
    obfuscator = ASTObfuscator(seed)
    mutated_tree = obfuscator.visit(tree)
    ast.fix_missing_locations(mutated_tree)
    return astor.to_source(mutated_tree)

@app.post("/api/v1/chimera/llvm-mutate")
async def llvm_mutate(req: Request):
    body = await req.json()
    payload = body.get('payload', '')
    seed = body.get('seed', int.from_bytes(os.urandom(4), 'big'))
    is_windows = sys.platform == 'win32'
    print(f"\n{CYAN}[🔍] LLVM Mutator: Request received. Seed={seed}, PayloadLength={len(payload)}{RESET}")
    if is_windows:
        print(f"{YELLOW}[⚙️] Running on Windows: Performing AST mutation fallback...{RESET}")
        mutated_code = mutate_ast_fallback(payload, seed)
        print(f"{GREEN}[⚡] Mutation generated successfully. Mode=ast_fallback{RESET}\n")
        return {
            "mutated_ir_hash": hashlib.sha256(mutated_code.encode()).hexdigest(),
            "elf_b64": base64.b64encode(mutated_code.encode()).decode(), 
            "seed": seed,
            "mode": "ast_fallback"
        }
    else:
        try:
            print(f"{YELLOW}[⚙️] Cythonizing payload for LLVM compilation...{RESET}")
            ir = compile_to_llvm_ir(payload)
            print(f"{YELLOW}[⚙️] Mutating LLVM IR with opaque predicates...{RESET}")
            mutated_ir = mutate_llvm_ir(ir, seed)
            print(f"{YELLOW}[⚙️] Compiling mutated IR back to ELF binary...{RESET}")
            elf_bytes = compile_ir_to_elf(mutated_ir)
            print(f"{GREEN}[⚡] Mutation generated successfully. Mode=llvm_ir{RESET}\n")
            return {
                "mutated_ir_hash": hashlib.sha256(mutated_ir.encode()).hexdigest(),
                "elf_b64": base64.b64encode(elf_bytes).decode(),
                "seed": seed,
                "mode": "llvm_ir"
            }
        except Exception as e:
            print(f"{RED}[⚠️] LLVM pipeline error: {e}. Falling back to AST mutation...{RESET}")
            mutated_code = mutate_ast_fallback(payload, seed)
            print(f"{GREEN}[⚡] Mutation generated successfully. Mode=ast_fallback_due_to_error{RESET}\n")
            return {
                "mutated_ir_hash": hashlib.sha256(mutated_code.encode()).hexdigest(),
                "elf_b64": base64.b64encode(mutated_code.encode()).decode(), 
                "seed": seed,
                "mode": "ast_fallback_due_to_error",
                "error": str(e)
            }

@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8003)
