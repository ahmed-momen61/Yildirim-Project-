import os
import ast
import astunparse

def remove_docstrings(source):
    try:
        parsed = ast.parse(source)
        for node in ast.walk(parsed):
            # Not all nodes can have docstrings, but we try removing expressions that are strings
            # The safe way to remove docstrings in Python is using ast and then unparsing.
            if not isinstance(node, (ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef, ast.Module)):
                continue
            
            if not len(node.body):
                continue
                
            if not isinstance(node.body[0], ast.Expr):
                continue
                
            if not hasattr(node.body[0], 'value') or not isinstance(node.body[0].value, ast.Str):
                continue
                
            # It's a docstring!
            node.body.pop(0)
            
        return astunparse.unparse(parsed)
    except Exception as e:
        return None

def strip_py_comments():
    base_dir = os.path.join(os.path.dirname(__file__), '..', 'ml_engine')
    if not os.path.exists(base_dir):
        return
        
    for root, dirs, files in os.walk(base_dir):
        for file in files:
            if file.endswith('.py'):
                file_path = os.path.join(root, file)
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                new_content = remove_docstrings(content)
                if new_content and new_content != content:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f"Stripped docstrings from: {file_path}")

if __name__ == '__main__':
    try:
        import astunparse
        strip_py_comments()
        print("Python docstring stripping complete.")
    except ImportError:
        print("astunparse not installed. Installing and running...")
        os.system('pip install astunparse')
        import astunparse
        strip_py_comments()
        print("Python docstring stripping complete.")
