#!/usr/bin/env python3
"""
Telemost Transcriber — Native Messaging Host.
Receives questions from the Chrome extension, forwards them to Claude CLI,
and returns responses via Chrome Native Messaging protocol.
"""

import json
import os
import struct
import subprocess
import sys

LOG_PREFIX = '[TT:HOST]'
CONTEXT_FILE = 'context.md'
CLAUDE_TIMEOUT_S = 120
DEFAULT_MODEL = 'claude-sonnet-4-20250514'

# Windows requires binary mode on stdin/stdout for the NM protocol
if os.name == 'nt':
    import msvcrt
    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)


def log(msg):
    """Log to stderr (Chrome captures stdout for NM protocol)."""
    sys.stderr.write(f'{LOG_PREFIX} {msg}\n')
    sys.stderr.flush()


def read_message():
    """Read a Chrome Native Messaging message from stdin (binary)."""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length or len(raw_length) < 4:
        return None
    length = struct.unpack('<I', raw_length)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode('utf-8'))


def write_message(obj):
    """Write a Chrome Native Messaging message to stdout (binary UTF-8)."""
    data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def load_context():
    """Load context from context.md in the same directory as this script."""
    context_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), CONTEXT_FILE)
    try:
        with open(context_path, 'r', encoding='utf-8') as f:
            content = f.read().strip()
        # Skip if file only contains comments
        lines = [l for l in content.splitlines() if l.strip() and not l.strip().startswith('#')]
        return '\n'.join(lines)
    except FileNotFoundError:
        return ''


def handle_ping(_msg):
    """Respond to ping with pong."""
    return {'type': 'pong'}


def handle_ask(msg):
    """Run claude -p with the question and optional context."""
    question = msg.get('question', '').strip()
    if not question:
        return {'type': 'error', 'error': 'Empty question'}

    model = msg.get('model', DEFAULT_MODEL)
    context = load_context()
    if context:
        prompt = f'Context:\n{context}\n\nQuestion:\n{question}'
    else:
        prompt = question

    log(f'Asking Claude (model={model}): {question[:80]}...')

    # Force UTF-8 for subprocess to avoid cp1251/cp866 garbling on Windows
    env = os.environ.copy()
    env['PYTHONIOENCODING'] = 'utf-8'

    try:
        result = subprocess.run(
            ['claude', '-p', '--model', model, prompt],
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=CLAUDE_TIMEOUT_S,
            env=env
        )
        if result.returncode != 0:
            error_text = result.stderr.strip() or f'Claude exited with code {result.returncode}'
            log(f'Claude error: {error_text}')
            return {'type': 'error', 'error': error_text}

        answer = result.stdout.strip()
        log(f'Claude answered: {answer[:80]}...')
        return {'type': 'answer', 'text': answer}

    except FileNotFoundError:
        log('Claude CLI not found')
        return {'type': 'error', 'error': 'Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code'}
    except subprocess.TimeoutExpired:
        log(f'Claude timed out after {CLAUDE_TIMEOUT_S}s')
        return {'type': 'error', 'error': f'Claude request timed out after {CLAUDE_TIMEOUT_S} seconds'}
    except Exception as e:
        log(f'Unexpected error: {e}')
        return {'type': 'error', 'error': str(e)}


REQUEST_HANDLERS = {
    'ping': handle_ping,
    'ask': handle_ask,
}


def main():
    log('Host started')
    while True:
        msg = read_message()
        if msg is None:
            log('Stdin closed, exiting')
            break

        msg_type = msg.get('type', '')
        handler = REQUEST_HANDLERS.get(msg_type)

        if handler:
            try:
                response = handler(msg)
            except Exception as e:
                log(f'Handler error for {msg_type}: {e}')
                response = {'type': 'error', 'error': f'Internal error: {e}'}
        else:
            log(f'Unknown message type: {msg_type}')
            response = {'type': 'error', 'error': f'Unknown request type: {msg_type}'}

        write_message(response)


if __name__ == '__main__':
    main()
