jvm.interpreter = {};

(function() {
	this.currentThread = {
		frames: [],
		javaThreadObject: null,
		printStackTrace: function(){
			for(var i=0; i<this.frames.length; ++i){
				var frame = this.frames[i];
				console.log(new Array(i+1).join('  ') + frame.clazz.name + '.' + frame.method.name);
			}
		}
	};
	
	// tokens
	this.__block = {};
	
	// var doNotYieldLock = 0;
	
	var threads = this.threads = [this.currentThread];
	var currentThreadIndex = 0;
	
	var frames = threads[0].frames;
	
	var frame; // current stack frame
	var clazz, method, locals; // current clazz, method and local variables
	var cp; // constant pool
	var bytes, offset, pos; // raw class bytes, offset of first instruction in that array, current position.
	var stack; // operand stack.
	
	var done = false;
	
	var __nothing = {};
	
	// this.invokeStatic = function(clazz, methodName, params) {
	// 	if (!clazz.methods[methodName]) {
	// 		throw "No such method " + methodName + " in class " + clazz.name;
	// 	}
	// 	jvm.interpreter.invoke(clazz, clazz.methods[methodName], params || []);
	// };
	
	this.startThread = function(nextClazz, nextMethod, nextLocals) {
		var t = {
				frames: [{
					clazz: nextClazz,
					method: nextMethod,
					locals: nextLocals,
					stack: [],
					pc: 0
				}],
				javaThreadObject: nextLocals[0]
			};
		threads.push(t);
		return t;
	};
	
	this.invokeFirst = function(nextClazz, nextMethod, nextLocals) {
		// doNotYieldLock++;
		this.invoke(nextClazz, nextMethod, nextLocals || []);
		frame.doReturn = true;
		this.resume();
		// doNotYieldLock--;
		done = false;
	};
	
	this.invoke = function(nextClazz, nextMethod, nextLocals) {
		if (frame) {
			frame.pc = pos - offset;
		}
		var nextframe = {
			clazz: nextClazz,
			method: nextMethod,
			locals: nextLocals,
			stack: [],
			pc: 0
		}
		frames.push(nextframe);
		loadFrame(nextframe);
		// If this is a synchronized method, maybe wait
		if (nextMethod.access_flags & 0x0020) { // synchronized
			(nextMethod.access_flags & 0x0008) ? this.monitorEnter(nextClazz) : this.monitorEnter(nextLocals[0]);
		}
	};
	
	this.invokeNative = function(nativemethod, parameters) {
		var ret = nativemethod.apply(this, parameters);
		if(typeof ret == 'string') debugger; //string必须返回java的String对象，使用jvm.newString()创建
		if (ret === this.__block) {
			var me = this;
			this.currentThread.onResume = function() {
				me.invokeNative(nativemethod, parameters);
			}
			this.currentThread.sleeping = true;
			this.halt();
			this.yield();
			return;
		}
		if (ret !== undefined) {
			stack.push(ret);
		}
	}
	
	this.halt = function() {
		frame.pc = pos - offset;
		done = true;
	};
	
	this.yield = function() {
//		if (doNotYieldLock) {
//			return;
//		}
		var newIndex = -1;
		// Test all threads to find another running thread.
		// If none, done = true
		for(var i = 0; i < threads.length; i++) {
			newIndex = (currentThreadIndex + i + 1) % threads.length;
			if (threads[newIndex].sleeping) {
				continue;
			}
			if (threads[newIndex].waitFor) {
				var lock = threads[newIndex].waitFor;
				if (lock.monitor == null) {
					// Monitor has become free
					var nextThread = threads[newIndex];
					lock.monitor = nextThread;
					if (nextThread.oldMonitorCount) {
						lock.monitorCount = nextThread.oldMonitorCount;
						nextThread.oldMonitorCount = null;
					} else {
						lock.monitorCount = 1;
					}
					nextThread.waitFor = null;
					break;
				}
			} else {
				break;
			}
		}
		
		if (i == threads.length) {
			done = true;
		} else {
			currentThreadIndex = newIndex;
			this.currentThread = threads[newIndex];
			frames = this.currentThread.frames;
			if (frame) {
				frame.pc = pos - offset;
			}
			loadFrame(frames[frames.length - 1]);
			if (done) {
				this.resume();
			}
		}
	};
	
	this.monitorEnter = function(objectref) {
		if (objectref.monitor) {
			if (objectref.monitor == this.currentThread) {
				objectref.monitorCount++;
			} else {
				this.currentThread.waitFor = objectref;
				this.yield();
			}
		} else {
			objectref.monitor = this.currentThread;
			objectref.monitorCount = 1;
		}
	};
	
	this.monitorExit = function(objectref) {
		if (objectref.monitor) {
			if (objectref.monitor != this.currentThread) {
				debugger;
			}
			objectref.monitorCount--;
			if (objectref.monitorCount == 0) {
				objectref.monitor = null;
			}
		} else {
			debugger;
		}
	};
	
	function loadFrame(nextframe) {
		if (nextframe === frame) {
			return;
		}
		clazz = nextframe.clazz;
		method = nextframe.method;
		locals = nextframe.locals;
		stack = nextframe.stack;
		
		cp = clazz.constant_pool;
		
		bytes = clazz.bytes;
		offset = method.codepos + 8;
		pos = offset + nextframe.pc;
		
		frame = nextframe;
	}
	
	function doReturn(returnvalue) {
		if (method.access_flags & 0x0020) { // synchronized
			(method.access_flags & 0x0008) ? jvm.interpreter.monitorExit(clazz) : jvm.interpreter.monitorExit(locals[0]);
		}
		var thisframe = frames.pop();
		if (thisframe.doReturn) {
			thisframe.doReturn = false;
			done = true;
		}
		if (frames.length == 0) {
			// Thread is done.. remove it from threads.
			if (threads.length > 1) {
				threads.splice(currentThreadIndex, 1);
				jvm.interpreter.yield();
			} else {
				done = true;
			}
			return;
		}
		var nextframe = frames[frames.length - 1];
		loadFrame(nextframe);
		if (returnvalue !== __nothing) {
			stack.push(returnvalue);
		}
	}
	
	function u1() {
		return bytes[pos++];
	}
	
	function u2() {
		return (bytes[pos++] << 8) + bytes[pos++];
	}
	
	function sint() {
		var val = (bytes[pos++] << 8) + bytes[pos++];
		return (val > 0x7FFF) ? - (0xFFFF - val) - 1 : val;
	}
	
	function sint4() {
		var val = u4();
		return (val > 0x7FFFFFFF) ? - (0xFFFFFFFF - val) - 1 : val;
	}
	
	function sbyte() {
		var val = bytes[pos++];
		return (val > 0x7F) ? - (0xFF - val) - 1 : val;
	}
	
	function u4() {
		return 256*256*256*bytes[pos++] + 256*256*bytes[pos++] + 256*bytes[pos++] + bytes[pos++];
	}
	
	function log() {
		if (jvm.verbose) {
			console.log.apply(console, arguments);
		}
	}
	
	this.resume = function() {
		done = false;
		if (this.currentThread.onResume) {
			var f = this.currentThread.onResume;
			this.currentThread.onResume = null;
			f();
		}
		var opsuntilyield = 20000;
		while(!done) {
			frame.pc = pos - offset;
			if (opsuntilyield-- < 0) {
				opsuntilyield = 20000;
				this.yield();
			}
			if(this.currentThread.__thrown !== undefined) {
				var found = false;
				for(var j = 0; j < method.exception_handlers.length; j++) {
					var handler = method.exception_handlers[j];
					var pc = pos - offset;
					if(pc < handler.start_pc || pc > handler.end_pc) {
						continue;
					}
					if (handler.catch_type) {
						var catchclazz = jvm.loadClass(handler.catch_type);
						if (!this.instanceOf(this.currentThread.__thrown, catchclazz)) continue;
					}
					//catched
					stack = [this.currentThread.__thrown];
					pos = offset + handler.handler_pc;
					found = true;
					this.currentThread.__thrown = undefined;
					break;
				}
				if (!found) {
					doReturn(__nothing);
					continue;
				}
			}
	
			var instr = bytes[pos++];
//			if (jvm.verbose) {
//			log("method : " + clazz.name + "." + method.name + method.descriptor + ", pc=" + (pos - offset));
//			log("instr: ",instr);
				//		console.log("stack: ",stack);
//			log("stack: (" + stack.length + ") ",stack[0], stack[1], stack[2]);
//			log("locals: (" + locals.length + ") ",locals[0], locals[1], locals[2], locals[3]);
//			}
			switch(instr) {
			case 0: //nop
				break;
				
			case 1: // aconst_null
				stack.push(null);
				break;
			case 2:
			case 3:
			case 4:
			case 5:
			case 6:
			case 7:
			case 8: // iconst_<i>
				stack.push(instr-3);
				break;
			case 9: // lconst_0
				stack.push(Long.fromNumber(0));
				break;
			case 10: // lconst_1
				stack.push(Long.fromNumber(1));
				break;
			case 11: // fconst_0
				stack.push(0.0);
				break;
			case 12: // fconst_1
				stack.push(1.0);
				break;
			case 13: // fconst_2
				stack.push(2.0);
				break;
			case 14: // dconst_0
				stack.push(0.0);
				break;
			case 15: // dconst_1
				stack.push(1.0);
				break;
			case 16: // bipush
				stack.push(sbyte());
				break;
			case 17: // sipush
				stack.push(sint());
				break;
			case 18: // ldc
			case 19: // ldc_w
			case 20: // ldc2_w
				var idx;
				if (instr == 18) {
					idx = bytes[pos++];
				} else {
					idx = u2();
				}
				var type = clazz.constant_pool_types[idx];
				switch(type) {
				case 1: // utf-8
					debugger;
				case 8: // String
					var strInfo = cp[idx];
					if(typeof strInfo == 'number'){ //最初是utf8引用，初始化后变为jvm.stringPool字符串常量池中对象的引用
						strInfo = cp[idx] = jvm.newInternedString(cp[strInfo]); // interned
					}
					stack.push(strInfo);
					break;
				case 7: // Class
					var cls = cp[cp[idx]];
					if (cls.substring(0, 1) == "[") {
						stack.push(jvm.getClassClass('array', jvm.getClassFromDescriptor(cls.substring(1))));
					} else {
						stack.push(jvm.getClassClass('object', jvm.loadClass(cls)));
					}
					break;
				default:
					stack.push(cp[idx]);
					break;
				}
				break;
			case 21: // iload
			case 22: // lload
			case 23: // fload
			case 24: // dload
			case 25: // aload
				stack.push(locals[bytes[pos++]]);
				break;
			case 26:
			case 27:
			case 28:
			case 29:
				// iload_<n>
				stack.push(locals[instr-26]);
				break;
			case 30: // lload_<n>
			case 31: 
			case 32: 
			case 33: 
				stack.push(locals[instr-30]);
				break;
			case 34: // fload_<n>
			case 35: // fload_<n>
			case 36: // fload_<n>
			case 37: // fload_<n>
				stack.push(locals[instr-34]);
				break;
			case 38: // dload_<n>
			case 39: // dload_<n>
			case 40: // dload_<n>
			case 41: // dload_<n>
				stack.push(locals[instr-38]);
				break;
			case 42:
			case 43:
			case 44:
			case 45: // aload_<n>
				stack.push(locals[instr-42]);
				break;
			case 46: // iaload
			case 47: // laload
			case 50: // aaload
			case 51: // baload
				var index = stack.pop();
				var arrayref = stack.pop();
				if (!arrayref) {
					debugger;
				}
				stack.push(arrayref[index]);
				break;
			case 52: // caload
				var index = stack.pop();
				var arrayref = stack.pop();
				var value = arrayref[index];
				if(typeof value == 'string'){
					debugger; //value.charCodeAt(0)?
				}
				stack.push(value);
				break;
			case 54: // istore
			case 55: // lstore
			case 56: // fstore
			case 57: // dstore
			case 58: // astore
				locals[bytes[pos++]]  = stack.pop();
				break;
			case 59:
			case 60:
			case 61:
			case 62: // istore
				locals[instr-59] = stack.pop();
				break;
			case 63:
			case 64:
			case 65:
			case 66: // lstore
				locals[instr-63] = stack.pop();
				break;
			case 67:
			case 68:
			case 69:
			case 70: // fstore
				locals[instr-67] = stack.pop();
				break;
			case 71:
			case 72:
			case 73:
			case 74: // dstore_<n>
				locals[instr-71] = stack.pop();
				break;
			case 75:
			case 76:
			case 77:
			case 78: // astore_<n>
				locals[instr-75] = stack.pop();
				break;
			case 79: // iastore
			case 80: // lastore
			case 81: // fastore
			case 82: // dastore
			case 83: // aastore
			case 84: // bastore
				var value = stack.pop();
				var index = stack.pop();
				var arrayref = stack.pop();
				arrayref[index] = value;
				break;
			case 85: // castore
				var value = stack.pop();
				var index = stack.pop();
				var arrayref = stack.pop();
				if (index < 0) {
					debugger;
				}
				if(typeof value == 'string'){
					debugger; //String.fromCharCode(value)?
				}
				arrayref[index] = value;
				break;
			case 87: // pop
				stack.pop();
				break;
			case 88: // pop2
				stack.pop();
				break;
			case 89: // dup
				stack.push(stack[stack.length - 1]);
				break;
			case 90: // dup_x1
				var value2 = stack[stack.length - 2];
				var value1 = stack[stack.length - 1];
				stack.push(value1);
				stack[stack.length - 2] = value2;
				stack[stack.length - 3] = value1;
				break;
			case 92: //dup2
				var value2 = stack[stack.length - 2];
				var value1 = stack[stack.length - 1];
				stack.push(value2);
				stack.push(value1);
				break;
			case 93: //dup2_x1
				var value1 = stack.pop();
				var value2 = stack.pop();
				var value3 = stack.pop();
				stack.push(value2);
				stack.push(value1);
				stack.push(value3);
				stack.push(value2);
				stack.push(value1);
				break;
			case 94: //dup2_x2
				var value1 = stack.pop();
				var value2 = stack.pop();
				var value3 = stack.pop();
				var value4 = stack.pop();
				stack.push(value2);
				stack.push(value1);
				stack.push(value4);
				stack.push(value3);
				stack.push(value2);
				stack.push(value1);
				break;
			case 95: // swap
				var value = stack[stack.length - 1];
				stack[stack.length - 1] = stack[stack.length - 2];
				stack[stack.length - 2] = value;
				break;
			case 97: // ladd
				stack.push(stack.pop().add(stack.pop()));
				break;
			case 96: // iadd
			case 98: // fadd
			case 99: // dadd
				stack.push(stack.pop() + stack.pop());
				break;
			case 101: // lsub
				stack.push(stack.pop().negate().add(stack.pop()));
				break;
			case 100: // isub
			case 102: // fsub
			case 103: // dsub
				stack.push(- stack.pop() + stack.pop());
				break;
			case 105: // lmul
				stack.push(stack.pop().multiply(stack.pop()));
				break;
			case 104: // imul
			case 106: // fmul
			case 107: // dmul
				stack.push(stack.pop() * stack.pop());
				break;
			case 108: // idiv
				var value2 = stack.pop();
				var value1 = stack.pop();
				stack.push(Math.floor(value1 / value2));
				break;
			case 109: // ldiv
				var value2 = stack.pop();
				var value1 = stack.pop();
				stack.push(value1.div(value2));
				break;
			case 110: // fdiv
			case 111: // ddiv
				var value2 = stack.pop();
				var value1 = stack.pop();
				stack.push(value1 / value2);
				break;
			case 112: // irem
			case 115: // drem
			case 114: // frem
				var value2 = stack.pop();
				var value1 = stack.pop();
				stack.push(value1 % value2);
				break;
			case 113: // lrem
				var value2 = stack.pop();
				var value1 = stack.pop();
				stack.push(value1.modulo(value2));
				break;
			case 116: // ineg
			case 118: // fneg
			case 119: // dneg
				stack.push(- stack.pop());
				break;
			case 117: // lneg
				stack.push(stack.pop().negate())
				break;
			case 120: // ishl
				var value2 = stack.pop();
				var value1 = stack.pop();
				stack.push(value1 << (value2 & 0x1F));
				break;
			case 121: // lshl
				var value2 = stack.pop();
				var value1 = stack.pop();
				stack.push(value1.shiftLeft(value2));
				break;
			case 122: // ishr
				var value2 = stack.pop();
				var value1 = stack.pop();
				stack.push(value1 >> (value2 & 0x1F));
				break;
			case 123: // lshr
				var value2 = stack.pop();
				var value1 = stack.pop();
				stack.push(value1.shiftRight(value2));
				break;
			case 124: // iushr
				var value2 = stack.pop();
				var value1 = stack.pop();
				var s = value2 & 0x1F; // low 5 bits
				if (value1 >= 0) {
					stack.push(value1 >> s);
				} else {
					stack.push((value1 >> s) + (2 << ~s));
				}
				break;
			case 125: // lushr
				var value2 = stack.pop();
				var value1 = stack.pop();
				if(!value1.shiftRightUnsigned) {
					debugger;
				}
				stack.push(value1.shiftRightUnsigned(value2));
				break;
			case 126: // iand
				stack.push(stack.pop() & stack.pop());
				break;
			case 127: // land
				stack.push(stack.pop().and(stack.pop()));
				break;
			case 128: // ior
				stack.push(stack.pop() | stack.pop());
				break;
			case 129: // lor
				stack.push(stack.pop().or(stack.pop()));
				break;
			case 130: // ixor
				stack.push(stack.pop() ^ stack.pop());
				break;
			case 131: // lxor
				stack.push(stack.pop().xor(stack.pop()));
				break;
			case 132: // iinc
				locals[bytes[pos++]] += sbyte();
				break;
			case 133: // i2l
				stack.push(Long.fromNumber(stack.pop()));
				break;
			case 134: // i2f
			case 135: // i2d
				break;
			case 136: // l2i
				stack.push(stack.pop().toInt());
				break;
			case 137: // l2f
			case 138: // l2d
				stack.push(stack.pop().toNumber());
				break;
			case 139: // f2i
			case 142: // d2i
			case 143: // d2l
				stack[stack.length - 1] = Math.round(stack[stack.length - 1]);
				break;
			case 140: // f2l
				stack[stack.length - 1] = Long.fromNumber(stack[stack.length - 1]);
				break;
			case 144: // d2f
			case 141: // f2d
				break;
			case 145: // i2b
			case 146: // i2c
			case 147: // i2s
				break;
			case 148: // lcmp
				var value2 = stack.pop();
				var value1 = stack.pop();
				if (!value1.compare) {
					debugger;
				}
				stack.push(value1.compare(value2));
				break;
			case 149: // fcmpl
			case 150: // fcmpg
			case 151: // fcmpd
			case 152: // fcmpd
				var value2 = stack.pop();
				var value1 = stack.pop();
	////			if (instr == 149) {
	//				stack.push(value1 == value2 ? 0 : (value1 < value2 ? 1 : -1));
	//			} else {
					stack.push(value1 == value2 ? 0 : (value1 > value2 ? 1 : -1));
	//			}
				break;
			case 153: // ifeq
			case 154:
			case 155:
			case 156:
			case 157:
			case 158:
				var value = stack.pop();
				var branch = sint();
				if (
					(instr == 153 && value == 0) ||
					(instr == 154 && value != 0) ||
					(instr == 155 && value < 0)  ||
					(instr == 156 && value >= 0) ||
					(instr == 157 && value > 0)  ||
					(instr == 158 && value <= 0)) {
					pos = (pos - 3) + branch;
				}
				break;
			case 159: // if_icmpeq
			case 160: // if_icmpne
			case 161: // if_icmplt
			case 162: // if_icmpge
			case 163: // if_icmpgt
			case 164: // if_icmple
				var value2 = stack.pop();
				var value1 = stack.pop();
				if (typeof value1 == 'string') {
					debugger;
					//value1 = value1.charCodeAt(0);
				}
				if (typeof value2 == 'string') {
					debugger;
					//value2 = value2.charCodeAt(0);
				}
				var branch = sint();
				if ((instr == 159 && value1 == value2)
					|| (instr == 160 && value1 != value2)
					|| (instr == 161 && value1 < value2)
					|| (instr == 162 && value1 >= value2)
					|| (instr == 163 && value1 > value2)
					|| (instr == 164 && value1 <= value2)) {
					pos = (pos - 3) + branch;
				}
				break;
			case 165: // if_acmpeq
			case 166: // if_acmpne
				var value2 = stack.pop();
				var value1 = stack.pop();
				var branch = sint();
				// //TODO 临时测试
				// if(value1 && value1.getMetadata("clazzName") == 'java/lang/String') value1 = value1.toString();
				// if(value2 && value2.getMetadata("clazzName") == 'java/lang/String') value2 = value2.toString();
				if((instr == 165 && value2 == value1) ||
					(instr == 166 && value2 != value1)) {
					pos = (pos - 3) + branch;
				}
				break;
			case 167: //goto
				pos = (pos - 1) + sint();
				break;
			case 168: // jsr
				stack.push(pos + 2);
				var branch = sint();
				pos = (pos - 3) + branch;
				break;
			case 169: // ret
				var nextpos = locals[bytes[pos++]];
				pos = nextpos;
				break;
			case 170: // tableswitch
				var index = stack.pop();
				var mypos = pos - 1;
				while((pos - offset) % 4 > 0) {
					pos++;
				}
				var def = sint4();
				var low = sint4();
				var high = sint4();
				if (index < low || index > high) {
					pos = mypos + def;
				} else {
					pos += (index - low) * 4;
					pos = mypos + sint4();
				}
				break;
			case 171: // lookupswitch
				var key = stack.pop();
				var mypos = pos - 1;
				while((pos - offset) % 4 > 0) {
					pos++;
				}
				var def = sint4();
				var npairs = sint4();
				var found = false;
				for (var i = 0; i < npairs; i++) {
					var match = u4();
					var switchoffset = sint4();
					if (match == key) {
						pos = mypos + switchoffset;
						found = true;
						break;
					}
				}
				if (!found) {
					pos = mypos + def;
				}
				break;
			case 172: // ireturn;
			case 173: // lreturn;
			case 174: // freturn;
			case 175: // dreturn;
			case 176: // areturn;
				doReturn(stack.pop());
				break;
			case 177: // return;
				doReturn(__nothing);
				break;
			case 178: // getstatic
				var fielddesc = cp[u2()];
				var fieldname = cp[cp[fielddesc.name_and_type_index].name_index];
				var clsName = cp[cp[fielddesc.class_index]];
				var clz = jvm.loadClass(clsName);
				if (!(fieldname in clz.fields)) {
					while(clz.superClass) {
						clz = jvm.loadClass(clz.superClass);
						if (fieldname in clz.fields) {
							break;
						}
					}
				}
				var val = clz.fields[fieldname].static_value;
				if(val === undefined){
					val = this.getDefaultValueByDescriptor(cp[cp[fielddesc.name_and_type_index].descriptor_index]);
				}
				stack.push(val);
				break;
				
			case 180: // getfield
				var fielddesc = cp[u2()];
				var fieldname = cp[cp[fielddesc.name_and_type_index].name_index];
				var jObj = stack.pop();
				
				if(typeof jObj == 'string') {
					debugger;
					//handleStringField(jObj, fieldname);
				} else {
					var val = jObj[fieldname];
					if (val === undefined) {
						val = jObj[fieldname] = this.getDefaultValueByDescriptor(cp[cp[fielddesc.name_and_type_index].descriptor_index]);
					}
					stack.push(val);
				}
				break;
			case 179: // putstatic
				var value = stack.pop();
				var fielddesc = cp[u2()];
				var fieldname = cp[cp[fielddesc.name_and_type_index].name_index]
				var cls = cp[cp[fielddesc.class_index]];
				var clz = jvm.loadClass(cls);
				while(!clz.fields[fieldname] && clz.superClass) {
					clz = jvm.loadClass(clz.superClass);
				}
				clz.fields[fieldname].static_value = value;
				break;
			case 181: // putfield
				var value = stack.pop();
				var jObj = stack.pop();
				var fielddesc = cp[u2()];
				if (!jObj) {
					debugger;
					this.currentThread.__thrown = jvm.newInstance("java/lang/NullPointerException");
					break;
				}
				jObj.setField(cp[cp[fielddesc.name_and_type_index].name_index], value);
				break;
			case 182: // invokevirtual
			case 183: // invokespecial
			case 184: // invokestatic
			case 185: // invokeinterface
				var methoddesc = cp[u2()];
				if (instr == 185) {
					u2();
				}
				var newlocals = [];
				var nameandtype = cp[methoddesc.name_and_type_index];
				var className = cp[cp[methoddesc.class_index]];
				var nextMethodName = cp[nameandtype.name_index] + cp[nameandtype.descriptor_index];
				var nextClazz = jvm.loadClass(className);
				if (!nextClazz) {
					break;
				}
				var nextMethod = nextClazz.methods[nextMethodName];
				//console.log(className + '.' + nextMethodName);
				while (!nextMethod) {
					var interfaceList = nextClazz.interfaces;
					function scanInterfaces(interfaces) {
						for(var i = 0; i < interfaces.length && !nextMethod; i++) {
							var intf = jvm.loadClass(interfaces[i]);
							nextMethod = intf.methods[nextMethodName];
							if (nextMethod) {
								return nextMethod;
							}
							if (intf.interfaces.length) {
								nextMethod = scanInterfaces(intf.interfaces);
								if (nextMethod) {
									return nextMethod;
								}
							}
						}
					}
					if (interfaceList.length) {
						nextMethod = scanInterfaces(interfaceList);
					}
					if (nextMethod || !nextClazz.superClass) {
						break;
					}
					nextClazz = jvm.loadClass(nextClazz.superClass);
					nextMethod = nextClazz.methods[nextMethodName];
				}
				var objectref = null;
				if (!nextMethod) debugger;
				
				for(var i = nextMethod.paramTypes.length - 1; i >= 0 ; i--) {
					if (nextMethod.paramTypes[i] == 'J' || nextMethod.paramTypes[i] == 'D') {
						newlocals.unshift(null);
						newlocals.unshift(stack.pop());
					} else {
						newlocals.unshift(stack.pop());
					}
				}
				if (instr != 184) { //invokestatic
					objectref = stack.pop();
					newlocals.unshift(objectref); // objectref
					if (newlocals[0] === null || newlocals[0] === undefined) {
						debugger;
						var ex = jvm.newInstance("java/lang/NullPointerException");
						ex.thrownClass = clazz.name;
						ex.thrownMethod = method.name;
						this.currentThread.__thrown = ex;
						break;
					}
				}
				
				if (instr == 182) { // invokevirtual
					nextClazz = objectref.getClazz(); 
					nextMethod = nextClazz.methods[nextMethodName];
					while (!nextMethod) {
						if (!nextClazz.superClass) {
							break;
						}
						nextClazz = jvm.loadClass(nextClazz.superClass);
						nextMethod = nextClazz.methods[nextMethodName];
					}
				}
				
				if (instr == 185) {
					// interface. Fetch real class from objectref
					nextClazz = newlocals[0].getClazz();
					if (!nextClazz) {
						debugger;
						if (typeof newlocals[0] == 'string') {
							debugger;
							//nextClazz = jvm.loadClass("java/lang/String");
						}
					}
					nextMethod = nextClazz.methods[nextMethodName];
					while(!nextMethod && nextClazz.superClass) {
						nextClazz = jvm.loadClass(nextClazz.superClass);
						nextMethod = nextClazz.methods[nextMethodName];
					}
				}
//				console.log(nextClazz.name + ": " + nextMethodName + ": " + (newlocals))
				if (nextMethod.codepos == -1) {
					// native
					var fqn = nextClazz.name + "." + nextMethodName;
					if (!jvm.nativemethods[fqn]) {
						throw "No implementation for native method " + fqn;
					}
					this.invokeNative(jvm.nativemethods[fqn], newlocals);
				} else {
					this.invoke(nextClazz, nextMethod, newlocals);
				}
				break;
			case 187: // new
				var cls = cp[cp[u2()]];
				stack.push(jvm.newInstance(cls));
				break;
			case 188: // newarray
				var count = stack.pop();
				var type = bytes[pos++];
				var clzs = {
					4: CLAZZ_BOOLEAN,
					5: CLAZZ_CHAR,
					6: CLAZZ_FLOAT,
					7: CLAZZ_DOUBLE,
					8: CLAZZ_BYTE,
					9: CLAZZ_SHORT,
					10: CLAZZ_INT,
					11: CLAZZ_LONG
				}
				var componentClazz = clzs[type];
				stack.push(jvm.newArray(componentClazz, count));
				break;
			case 189: // anewarray
				var count = stack.pop();
				cls = cp[cp[u2()]];
				var componentClazz = jvm.loadClass(cls);
				stack.push(jvm.newArray(componentClazz, count));
				break;
			case 190: // arraylength
				stack.push(stack.pop().length);
				break;
			case 191: // athrow
				this.currentThread.__thrown = stack.pop();
				break;
			case 192: // checkcast
				u2();
				break;
			case 193: // instanceof
				var objectref = stack.pop();
				var cls = cp[cp[u2()]];
				stack.push(this.instanceOf(objectref, jvm.loadClass(cls)) ? 1 : 0);
				break;
			case 194: //monitorenter
				this.monitorEnter(stack.pop());
				break;
			case 195: //monitorexit
				this.monitorExit(stack.pop());
				break;
			case 196: //
				var opcode = bytes[pos++];
				if (opcode == 132) { // iinc
					var index = u2();
					locals[index] += sint();
				} else {
					debugger;
				}
				break;
			case 197: // multianewarray
				var cls = cp[cp[u2()]];
				var dimensions = u1();
				var counts = [];
				for(var i = 0; i < dimensions; ++i) {
					counts.unshift(stack.pop());
				}

				var arrayobject = jvm.newArray(jvm.loadClass(cls), counts[0]);
				var curArray = arrayobject;
				for(var i = 0; i < dimensions-1; ++i){ //当前第几层，创建下一层数组并链接到本层
					var firstLowerArray = null, curLowerArray = null, lastLowerArray = null;
					var dimensionClazz = jvm.loadClass(cls.substring(i+1));
					do{ //当前数组是否还有下一个兄弟
						for(var j = 0; j < counts[i]; ++j) { //创建下一层数组，并链接到当前层数组
							curLowerArray = jvm.newArray(dimensionClazz, counts[i+1]);
							curArray[j] = curLowerArray;
							if(j == 0){
								if(!firstLowerArray) firstLowerArray = curLowerArray;
							}
							if(lastLowerArray) lastLowerArray.setMetadata("nextSibling", curLowerArray);
							lastLowerArray = curLowerArray;
						}
					}while(curArray = curArray.getMetadata("nextSibling"));
					curArray = firstLowerArray;
					firstLowerArray = null;
				}
				stack.push(arrayobject);
				break; 
			case 198: // ifnull
			case 199: // ifnonnull
				var branch = sint();
				var value = stack.pop();
				if((instr == 198 && (value === null || value === undefined)) ||
					(instr == 199 && value !== null && value !== undefined)) {
					pos = (pos - 3) + branch;
				}
				break;
			default:
				throw("unimplemented instruction: " + instr);
			}
		}
		
	//	var exception_table_length = reader.u2();
	//	for(var i = 0; i < exception_table_length; i++) {
	//		var start_pc = reader.u2();
	//		var end_pc = reader.u2();
	//		var handler_pc = reader.u2();
	//		var catch_type = reader.u2();
	//	}
	}
	
	jvm.interpreter.doThrow = function(throwable) {
		this.currentThread.__thrown = throwable;
	}
	
	jvm.interpreter.instanceOf = function(instance, clazz) {
		if (instance === null) {
			return false;
		}
		if (typeof instance == 'string') {
			debugger;
			//return clazz.name == 'java/lang/String';
		} else if (instance && instance.getClazz() == clazz) {
			return true;
		} else {
			if (instance.getType() == 'array') {
				
			} else {
				// Check superclasses
				if (clazz.access_flags & 0x0200) {
					// interface
					var test = instance.getClazz();
					while (test) {
						for(var i = 0; i < test.interfaces.length; i++) {
							if (test.interfaces[i] == clazz.name) {
								return true;
							}
						}
						test = test.superClass && jvm.loadClass(test.superClass);
					}
					return false;
				} else {
					var test = instance.getClazz().superClass;
					while(test) {
						var testClass = jvm.loadClass(test);
						if (testClass == clazz) {
							return true;
						}
						test = testClass.superClass;
					}
					return false;
				}
			}
			return false;
		}
	}

	jvm.interpreter.getDefaultValueByDescriptor = function(descriptor){
		switch(descriptor) {
		case 'B':
		case 'D':
		case 'F':
		case 'I':
		case 'S':
			return 0;
		case 'J':
			return Long.fromNumber(0);
		case 'Z':
			return false;
			break;
		case 'C':
			return "\u0000";
		default:
			return null;
		}
	}
	
}).apply(jvm.interpreter);
