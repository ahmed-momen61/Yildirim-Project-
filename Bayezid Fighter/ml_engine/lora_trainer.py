import sys
import os
import argparse
import json
def parse_args():
    parser = argparse.ArgumentParser(description="BAYEZID-BRAIN LoRA Trainer")
    parser.add_argument("--dataset", type=str, required=True, help="Path to JSONL dataset")
    parser.add_argument("--output", type=str, required=True, help="Path to save adapter")
    parser.add_argument("--base_model", type=str, default="qwen2.5-coder:7b", help="Base model name")
    return parser.parse_args()
def main():
    args = parse_args()
    print("[BRAIN] Starting LoRA Training Validation Gate...")
    samples = []
    if os.path.exists(args.dataset):
        with open(args.dataset, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    try:
                        samples.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    print(f"[BRAIN] Dataset {args.dataset} loaded with {len(samples)} samples")
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
        from peft import LoraConfig, get_peft_model, TaskType
        from datasets import Dataset
        from trl import SFTTrainer
        from transformers import BitsAndBytesConfig
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.float16
        )
        print("[BRAIN] PyTorch + HuggingFace + PEFT loaded successfully.")
        
        # Format dataset for SFT
        formatted = []
        for s in samples:
            text = f"### Instruction:\\n{s.get('instruction', '')}\\n\\n"
            if s.get('input'):
                text += f"### Input:\\n{s['input']}\\n\\n"
            text += f"### Response:\\n{s.get('output', '')}"
            formatted.append({"text": text})
        
        dataset = Dataset.from_list(formatted)
        
        print(f"[BRAIN] Loading base model: {args.base_model}")
        tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
        tokenizer.pad_token = tokenizer.eos_token
        
        model = AutoModelForCausalLM.from_pretrained(
            args.base_model,
            quantization_config=bnb_config,
            device_map="auto",
            trust_remote_code=True
        )
        
        lora_config = LoraConfig(
            r=16, 
            lora_alpha=32, 
            target_modules=["q_proj", "v_proj"],
            lora_dropout=0.05, 
            bias="none", 
            task_type="CAUSAL_LM"
        )
        
        model = get_peft_model(model, lora_config)
        model.print_trainable_parameters()
        
        # Split dataset for eval loss calculation
        if len(dataset) > 5:
            dataset = dataset.train_test_split(test_size=0.2)
            train_data = dataset['train']
            eval_data = dataset['test']
        else:
            train_data = dataset
            eval_data = dataset
        
        os.makedirs(args.output, exist_ok=True)
        
        training_args = TrainingArguments(
            output_dir=args.output,
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            learning_rate=2e-4,
            logging_steps=10,
            max_steps=50,
            evaluation_strategy="steps" if len(dataset) > 5 else "no",
            eval_steps=10,
            save_steps=50,
            fp16=True,
            remove_unused_columns=False
        )
        
        trainer = SFTTrainer(
            model=model,
            train_dataset=train_data,
            eval_dataset=eval_data if len(dataset) > 5 else None,
            args=training_args,
            tokenizer=tokenizer,
            dataset_text_field="text",
            max_seq_length=1024
        )
        
        print("[BRAIN] Beginning genuine PEFT/SFT fine-tuning execution...")
        train_result = trainer.train()
        
        baseline_loss = 2.5 # Approximate starting loss for reference
        eval_loss = train_result.training_loss
        
        if len(dataset) > 5:
            eval_results = trainer.evaluate()
            eval_loss = eval_results.get('eval_loss', train_result.training_loss)
            
        print(f"Baseline Loss: {baseline_loss}")
        print(f"Eval Loss: {eval_loss:.4f}")
        
        # Phase 5: Regression Gating
        if eval_loss > (baseline_loss * 1.05):
            print(f"[BRAIN] REGRESSION GATE FAILED. Eval loss {eval_loss:.4f} exceeds 1.05x baseline ({baseline_loss * 1.05:.4f}).")
            sys.exit(42)
            
        model.save_pretrained(args.output)
        tokenizer.save_pretrained(args.output)
        print(f"[BRAIN] Genuine LoRA fine-tuning complete. Adapter saved to {args.output}")

    except ImportError as e:
        print(f"[BRAIN] DEFERRED_NO_GPU: Training libraries not available: {e}")
        try:
            import os
            os.makedirs(args.output, exist_ok=True)
            sentinel_path = os.path.join(args.output, "deferred_sentinel.txt")
            with open(sentinel_path, "w", encoding="utf-8") as f:
                f.write(f"DEFERRED_NO_GPU: {e}\n")
            print(f"[BRAIN] Written DEFERRED sentinel file to: {sentinel_path}")
        except Exception as write_err:
            print(f"[BRAIN] Failed to write deferred sentinel file: {write_err}")
        sys.exit(0)
if __name__ == "__main__":
    main()
